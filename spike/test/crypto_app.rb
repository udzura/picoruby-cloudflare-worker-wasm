class CryptoApp
  SECRET = "0123456789abcdef0123456789abcdef"
  RAW_DATA = "\x00plain\xfftext"

  def self.call(env)
    case env["PATH_INFO"]
    when "/random"
      bytes = SecureRandom.random_bytes
      random = SecureRandom.random_number
      [200, { "content-type" => "text/plain" }, [
        [bytes.bytesize, bytes == "\x00" * 16, random >= 0.0 && random < 1.0].inspect,
      ]]
    when "/crypto"
      iv, encrypted = Crypto.encrypt(:AES_GCM, SECRET, RAW_DATA)
      decrypted = Crypto.decrypt(:AES_GCM, SECRET, iv, encrypted)
      [200, { "content-type" => "text/plain" }, [[
        iv.bytesize, encrypted.bytesize, decrypted == RAW_DATA, encrypted == RAW_DATA,
      ].inspect]]
    when "/crypto/tampered"
      iv, encrypted = Crypto.encrypt(:AES_GCM, SECRET, RAW_DATA)
      encrypted.setbyte(0, encrypted.getbyte(0) ^ 1)
      result = begin
        Crypto.decrypt(:AES_GCM, SECRET, iv, encrypted)
        "unexpected"
      rescue RuntimeError => error
        error.message
      end
      [200, { "content-type" => "text/plain" }, [result]]
    else
      [404, { "content-type" => "text/plain" }, ["Not found"]]
    end
  end
end

Rackup::Handler::CloudflareWorker.run(CryptoApp)
