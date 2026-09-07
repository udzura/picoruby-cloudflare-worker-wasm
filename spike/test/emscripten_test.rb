require "test/unit"
require "tmpdir"
require "fileutils"
require "open3"
require "rbconfig"

class EmscriptenTest < Test::Unit::TestCase
  def check_version(version, exit_status: 0)
    Dir.mktmpdir("spike-emscripten-test") do |root|
      File.write(File.join(root, "Rakefile"), "")
      if version
        command = File.join(root, "emcc")
        File.write(command, "#!/bin/sh\nprintf '%s\\n' 'emcc (Emscripten gcc/clang-like replacement) #{version}'\nexit #{exit_status}\n")
        File.chmod(0o755, command)
      end
      rakefile = File.expand_path("../Rakefile", __dir__)
      Open3.capture2e({ "PATH" => root, "PICORUBY_ROOT" => root },
        RbConfig.ruby, "-rrake", "-e", 'load ARGV.fetch(0); verify_emscripten!', rakefile)
    end
  end

  def test_accepts_5_and_later
    %w[5.0.0 5.0.7 6.0.9-git 7.0.0 10.0.0].each do |version|
      output, status = check_version(version)
      assert status.success?, output
    end
  end

  def test_rejects_old_and_unknown_versions
    %w[4.99.99 unknown].each do |version|
      output, status = check_version(version)
      assert !status.success?
      assert_include output, "Emscripten >= 5.0.0 is required"
    end
  end

  def test_rejects_failed_command
    output, status = check_version("6.0.9", exit_status: 1)
    assert !status.success?
    assert_include output, "emcc failed"
  end

  def test_missing_compiler_recommends_homebrew
    output, status = check_version(nil)
    assert !status.success?
    assert_include output, "brew install emscripten"
  end
end
