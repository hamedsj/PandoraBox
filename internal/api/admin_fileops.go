// SPDX-License-Identifier: Apache-2.0
package api

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// exportProjectZip creates an in-memory ZIP containing project.json and
// pandora.db from dataDir. Returns the raw ZIP bytes.
func exportProjectZip(dataDir string) ([]byte, error) {
	files := []string{"project.json", "pandora.db"}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	for _, name := range files {
		src := filepath.Join(dataDir, name)
		f, err := os.Open(src)
		if os.IsNotExist(err) {
			continue // skip missing files gracefully
		}
		if err != nil {
			return nil, fmt.Errorf("open %s: %w", name, err)
		}
		w, err := zw.Create(name)
		if err != nil {
			f.Close()
			return nil, fmt.Errorf("zip create %s: %w", name, err)
		}
		if _, err := io.Copy(w, f); err != nil {
			f.Close()
			return nil, fmt.Errorf("zip write %s: %w", name, err)
		}
		f.Close()
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("zip close: %w", err)
	}
	return buf.Bytes(), nil
}

// migrateDataDir copies all files from src to dst (creating dst if needed).
func migrateDataDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0755); err != nil {
		return fmt.Errorf("create dst dir: %w", err)
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return fmt.Errorf("read src dir: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		srcPath := filepath.Join(src, e.Name())
		dstPath := filepath.Join(dst, e.Name())
		if err := copyFile(srcPath, dstPath); err != nil {
			return fmt.Errorf("copy %s: %w", e.Name(), err)
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
