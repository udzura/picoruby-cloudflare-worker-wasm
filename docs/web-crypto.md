# Web Crypto API

The Worker runtime uses the browser-compatible Web Crypto API rather than a
PicoRuby pseudo-random generator for these methods. They are implemented by
this gem and do not use `mruby-securerandom`:

```ruby
SecureRandom.random_number  # secure Float in [0.0, 1.0)
SecureRandom.random_bytes   # 16 secure random bytes
SecureRandom.random_bytes(32)
```

AES-GCM uses a raw 16-, 24-, or 32-byte AES key. `encrypt` generates a fresh
12-byte IV and returns the IV with the authenticated ciphertext. The ciphertext
includes Web Crypto's 16-byte authentication tag.

```ruby
secret = SecureRandom.random_bytes(32)
iv, encrypted = Crypto.encrypt(:AES_GCM, secret, raw_data)
raw_data = Crypto.decrypt(:AES_GCM, secret, iv, encrypted)
```

Only `:AES_GCM` is supported. Authentication failures, including altered
ciphertext or IV, raise `RuntimeError`.
