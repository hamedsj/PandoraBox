// SPDX-License-Identifier: Apache-2.0
package ca

import (
	"crypto/tls"
	"sync"
)

type CertCache struct {
	ca    *CA
	cache sync.Map // host -> *tls.Certificate
}

func NewCertCache(ca *CA) *CertCache {
	return &CertCache{ca: ca}
}

func (c *CertCache) Get(host string) (*tls.Certificate, error) {
	if v, ok := c.cache.Load(host); ok {
		return v.(*tls.Certificate), nil
	}

	cert, err := c.ca.SignLeaf(host)
	if err != nil {
		return nil, err
	}

	c.cache.Store(host, &cert)
	return &cert, nil
}
