package ca

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"time"
)

type CA struct {
	cert    *x509.Certificate
	key     *ecdsa.PrivateKey
	certPEM []byte
}

func Load() (*CA, error) {
	dir, err := caDir()
	if err != nil {
		return nil, err
	}

	certPath := filepath.Join(dir, "ca.crt")
	keyPath := filepath.Join(dir, "ca.key")

	if _, err := os.Stat(certPath); err == nil {
		return loadFromFiles(certPath, keyPath)
	}

	return generate(certPath, keyPath)
}

// Regenerate deletes the existing CA and creates a new one.
func Regenerate() (*CA, error) {
	dir, err := caDir()
	if err != nil {
		return nil, err
	}
	os.Remove(filepath.Join(dir, "ca.crt"))
	os.Remove(filepath.Join(dir, "ca.key"))
	return Load()
}

func caDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".pandorabox")
	return dir, os.MkdirAll(dir, 0700)
}

// subjectKeyID computes the SHA-1 hash of the DER-encoded public key.
// This is the standard method per RFC 5280 §4.2.1.2.
func subjectKeyID(pub *ecdsa.PublicKey) ([]byte, error) {
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return nil, err
	}
	h := sha1.Sum(der)
	return h[:], nil
}

func generate(certPath, keyPath string) (*CA, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}

	skid, err := subjectKeyID(&key.PublicKey)
	if err != nil {
		return nil, err
	}

	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "PandoraBox CA",
			Organization: []string{"PandoraBox"},
		},
		SubjectKeyId:          skid,
		NotBefore:             time.Now().Add(-1 * time.Minute),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	keyDER, _ := x509.MarshalECPrivateKey(key)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	if err := os.WriteFile(certPath, certPEM, 0600); err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		return nil, err
	}

	cert, _ := x509.ParseCertificate(derBytes)
	return &CA{cert: cert, key: key, certPEM: certPEM}, nil
}

func loadFromFiles(certPath, keyPath string) (*CA, error) {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, err
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(certPEM)
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, err
	}

	keyBlock, _ := pem.Decode(keyPEM)
	key, err := x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		return nil, err
	}

	return &CA{cert: cert, key: key, certPEM: certPEM}, nil
}

func (ca *CA) CertPEM() string {
	return string(ca.certPEM)
}

func (ca *CA) CertBytes() []byte {
	return ca.certPEM
}

// SignLeaf creates a leaf TLS certificate for the given hostname.
// Includes SubjectKeyId and AuthorityKeyId as required by RFC 5280 / Chrome.
func (ca *CA) SignLeaf(host string) (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}

	skid, err := subjectKeyID(&key.PublicKey)
	if err != nil {
		return tls.Certificate{}, err
	}

	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	tmpl := &x509.Certificate{
		SerialNumber:   serial,
		Subject:        pkix.Name{CommonName: host},
		SubjectKeyId:   skid,
		AuthorityKeyId: ca.cert.SubjectKeyId, // links leaf → CA
		DNSNames:       []string{host},
		NotBefore:      time.Now().Add(-1 * time.Minute),
		NotAfter:       time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:       x509.KeyUsageDigitalSignature,
		ExtKeyUsage:    []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("sign leaf cert for %s: %w", host, err)
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	keyDER, _ := x509.MarshalECPrivateKey(key)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	return tls.X509KeyPair(certPEM, keyPEM)
}
