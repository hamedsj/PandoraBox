package main

import (
	"embed"
	"io/fs"
)

//go:embed dist
var embeddedUI embed.FS

func getUIFS() fs.FS {
	return embeddedUI
}
