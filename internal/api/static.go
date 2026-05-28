// SPDX-License-Identifier: Apache-2.0
package api

import (
	"io/fs"
)

// SetStaticFS sets the embedded UI filesystem. Called from main with go:embed FS.
func (s *Server) SetStaticFS(uiFS fs.FS) {
	s.uiFS = uiFS
}
