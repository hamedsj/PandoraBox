package proxy

import (
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	proj "github.com/hamedsj5/pandorabox/internal/project"
)

type ScopeChecker struct {
	mu  sync.RWMutex
	cfg proj.ScopeConfig
}

func (s *ScopeChecker) SetConfig(cfg proj.ScopeConfig) {
	s.mu.Lock()
	s.cfg = cfg
	s.mu.Unlock()
}

func (s *ScopeChecker) InScope(host, path string) bool {
	s.mu.RLock()
	cfg := s.cfg
	s.mu.RUnlock()

	if !cfg.Enabled {
		return true
	}

	var activeIncludes, activeExcludes []proj.ScopeRule
	for _, r := range cfg.IncludeRules {
		if r.Enabled {
			activeIncludes = append(activeIncludes, r)
		}
	}
	for _, r := range cfg.ExcludeRules {
		if r.Enabled {
			activeExcludes = append(activeExcludes, r)
		}
	}

	matchesInclude := len(activeIncludes) == 0
	for _, r := range activeIncludes {
		if matchRule(r, host, path) {
			matchesInclude = true
			break
		}
	}

	for _, r := range activeExcludes {
		if matchRule(r, host, path) {
			return false
		}
	}

	return matchesInclude
}

func matchRule(rule proj.ScopeRule, host, path string) bool {
	hostOK := matchPattern(rule.PatternType, rule.Host, host)
	pathOK := rule.Path == "" || matchPattern(rule.PatternType, rule.Path, path)
	return hostOK && pathOK
}

func matchPattern(typ, pattern, value string) bool {
	switch typ {
	case "exact":
		return pattern == value
	case "contains":
		return strings.Contains(value, pattern)
	case "wildcard":
		ok, _ := filepath.Match(pattern, value)
		return ok
	case "regex":
		ok, _ := regexp.MatchString(pattern, value)
		return ok
	}
	return false
}
