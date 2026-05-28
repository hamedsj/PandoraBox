// SPDX-License-Identifier: Apache-2.0
package converter

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

type Algorithm struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"` // decode | encode | hash | transform
}

type boopScript struct {
	algo       Algorithm
	scriptPath string
}

var excludedAlgorithmLabels = map[string]struct{}{
	"android strings to ios localizables":       {},
	"ios localizables to android strings":       {},
	"create project glossary markdown file":     {},
	"new boop script":                           {},
	"lorem ipsum":                               {},
	"generate hashtag":                          {},
	"markdown quote":                            {},
	"convert to pretty markdown table":          {},
	"list to html list":                         {},
	"js to php":                                 {},
	"toggle camel and hyphen":                   {},
	"deburr":                                    {},
	"replace smart quotes":                      {},
	"join lines":                                {},
	"join lines with comma":                     {},
	"join lines with space":                     {},
	"shuffle characters":                        {},
	"shuffle lines":                             {},
	"natural sort lines":                        {},
	"reverse lines":                             {},
	"wadsworth constant":                        {},
	"test script":                               {},
	"contrasting color":                         {},
	"well-known binary to text":                 {},
	"well-known text to binary":                 {},
	"eval javascript":                           {},
	"csv to json (headerless)":                  {},
	"from string from unicode scaped":           {},
	"digi to ascii":                             {},
	"trim end":                                  {},
	"trim start":                                {},
	"js object to json":                         {},
}

var nativeAlgorithms = []Algorithm{
	{ID: "base64_decode", Label: "Base64 Decode", Kind: "decode"},
	{ID: "base64_encode", Label: "Base64 Encode", Kind: "encode"},
	{ID: "url_decode", Label: "URL Decode", Kind: "decode"},
	{ID: "url_encode", Label: "URL Encode", Kind: "encode"},
	{ID: "hex_decode", Label: "Hex Decode", Kind: "decode"},
	{ID: "hex_encode", Label: "Hex Encode", Kind: "encode"},
	{ID: "html_unescape", Label: "HTML Unescape", Kind: "decode"},
	{ID: "html_escape", Label: "HTML Escape", Kind: "encode"},
	{ID: "json_pretty", Label: "JSON Pretty", Kind: "transform"},
	{ID: "json_minify", Label: "JSON Minify", Kind: "transform"},
	{ID: "rot13", Label: "ROT13", Kind: "transform"},
	{ID: "md5", Label: "MD5", Kind: "hash"},
	{ID: "sha1", Label: "SHA1", Kind: "hash"},
	{ID: "sha256", Label: "SHA256", Kind: "hash"},
	{ID: "sha512", Label: "SHA512", Kind: "hash"},
}

var (
	algoOnce       sync.Once
	allAlgorithms  []Algorithm
	boopByID       map[string]boopScript
	boopRunnerPath string
	boopCoreLibDir string
	algoInitErr    error
)

func Algorithms() []Algorithm {
	initAlgorithms()
	out := make([]Algorithm, len(allAlgorithms))
	copy(out, allAlgorithms)
	return out
}

func Transform(input, algorithm string) (string, error) {
	initAlgorithms()
	switch algorithm {
	case "base64_decode":
		b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(input))
		if err != nil {
			return "", err
		}
		return string(b), nil
	case "base64_encode":
		return base64.StdEncoding.EncodeToString([]byte(input)), nil
	case "url_decode":
		return urlQueryUnescape(input)
	case "url_encode":
		return urlQueryEscape(input), nil
	case "hex_decode":
		s := strings.TrimSpace(input)
		s = strings.TrimPrefix(s, "0x")
		b, err := hex.DecodeString(s)
		if err != nil {
			return "", err
		}
		return string(b), nil
	case "hex_encode":
		return hex.EncodeToString([]byte(input)), nil
	case "html_unescape":
		return strings.NewReplacer(
			"&lt;", "<",
			"&gt;", ">",
			"&amp;", "&",
			"&quot;", "\"",
			"&#39;", "'",
		).Replace(input), nil
	case "html_escape":
		return strings.NewReplacer(
			"&", "&amp;",
			"<", "&lt;",
			">", "&gt;",
			"\"", "&quot;",
			"'", "&#39;",
		).Replace(input), nil
	case "json_pretty":
		var v interface{}
		if err := json.Unmarshal([]byte(input), &v); err != nil {
			return "", err
		}
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return "", err
		}
		return string(b), nil
	case "json_minify":
		var v interface{}
		if err := json.Unmarshal([]byte(input), &v); err != nil {
			return "", err
		}
		b, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		return string(b), nil
	case "rot13":
		r := []rune(input)
		for i, c := range r {
			switch {
			case c >= 'a' && c <= 'z':
				r[i] = 'a' + ((c - 'a' + 13) % 26)
			case c >= 'A' && c <= 'Z':
				r[i] = 'A' + ((c - 'A' + 13) % 26)
			}
		}
		return string(r), nil
	case "md5":
		sum := md5.Sum([]byte(input))
		return hex.EncodeToString(sum[:]), nil
	case "sha1":
		sum := sha1.Sum([]byte(input))
		return hex.EncodeToString(sum[:]), nil
	case "sha256":
		sum := sha256.Sum256([]byte(input))
		return hex.EncodeToString(sum[:]), nil
	case "sha512":
		sum := sha512.Sum512([]byte(input))
		return hex.EncodeToString(sum[:]), nil
	}

	if s, ok := boopByID[algorithm]; ok {
		return runBoopScript(s.scriptPath, input)
	}

	if algoInitErr != nil {
		return "", algoInitErr
	}
	return "", fmt.Errorf("unknown algorithm: %s", algorithm)
}

func initAlgorithms() {
	algoOnce.Do(func() {
		allAlgorithms = append([]Algorithm{}, nativeAlgorithms...)
		boopByID = map[string]boopScript{}

		_, thisFile, _, ok := runtime.Caller(0)
		if !ok {
			algoInitErr = fmt.Errorf("cannot resolve converter package path")
			return
		}
		baseDir := filepath.Dir(thisFile)
		boopRoot := filepath.Join(baseDir, "boop")
		boopRunnerPath = filepath.Join(boopRoot, "runner.cjs")
		boopCoreLibDir = filepath.Join(boopRoot, "core_scripts", "lib")

		dirs := []struct {
			prefix string
			root   string
		}{
			{prefix: "boop_core", root: filepath.Join(boopRoot, "core_scripts")},
			{prefix: "boop_extra", root: filepath.Join(boopRoot, "extra_scripts")},
		}

		for _, d := range dirs {
			entries, err := os.ReadDir(d.root)
			if err != nil {
				continue
			}
			for _, e := range entries {
				if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".js") {
					continue
				}
				scriptPath := filepath.Join(d.root, e.Name())
				label := boopLabelFromScript(scriptPath, strings.TrimSuffix(e.Name(), ".js"))
				id := d.prefix + ":" + strings.TrimSuffix(e.Name(), ".js")
				algo := Algorithm{ID: id, Label: label, Kind: "transform"}
				if _, excluded := excludedAlgorithmLabels[strings.ToLower(strings.TrimSpace(algo.Label))]; excluded {
					continue
				}
				boopByID[id] = boopScript{algo: algo, scriptPath: scriptPath}
				allAlgorithms = append(allAlgorithms, algo)
			}
		}

		seenLabels := make(map[string]struct{}, len(allAlgorithms))
		deduped := make([]Algorithm, 0, len(allAlgorithms))
		for _, algo := range allAlgorithms {
			labelKey := strings.ToLower(strings.TrimSpace(algo.Label))
			if labelKey == "" {
				labelKey = strings.ToLower(strings.TrimSpace(algo.ID))
			}
			if _, exists := seenLabels[labelKey]; exists {
				continue
			}
			seenLabels[labelKey] = struct{}{}
			deduped = append(deduped, algo)
		}

		sort.Slice(deduped, func(i, j int) bool {
			return strings.ToLower(deduped[i].Label) < strings.ToLower(deduped[j].Label)
		})
		allAlgorithms = deduped
	})
}

func boopLabelFromScript(path, fallback string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return fallback
	}
	re := regexp.MustCompile(`"name"\s*:\s*"([^"]+)"`)
	m := re.FindSubmatch(data)
	if len(m) == 2 {
		return string(m[1])
	}
	return fallback
}

func runBoopScript(scriptPath, input string) (string, error) {
	if _, err := exec.LookPath("node"); err != nil {
		return "", fmt.Errorf("node is required for Boop-compatible scripts: %w", err)
	}
	payload := map[string]string{
		"script_path":  scriptPath,
		"core_lib_dir": boopCoreLibDir,
		"input":        input,
	}
	in, _ := json.Marshal(payload)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "node", boopRunnerPath)
	cmd.Stdin = bytes.NewReader(in)
	var out bytes.Buffer
	cmd.Stdout = &out
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := cmd.Run()
	var resp struct {
		Output string `json:"output"`
		Error  string `json:"error"`
	}
	_ = json.Unmarshal(out.Bytes(), &resp)
	if err != nil {
		if resp.Error != "" {
			return "", errors.New(resp.Error)
		}
		if stderr.Len() > 0 {
			return "", errors.New(strings.TrimSpace(stderr.String()))
		}
		return "", err
	}
	if resp.Error != "" {
		return "", errors.New(resp.Error)
	}
	return resp.Output, nil
}

func urlQueryUnescape(s string) (string, error) {
	return url.QueryUnescape(s)
}

func urlQueryEscape(s string) string {
	return url.QueryEscape(s)
}
