require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'react-native-jsoncanvas'
  s.version      = package['version']
  s.summary      = package['description']
  s.license      = package['license']
  s.homepage     = 'https://github.com/workspace-sh/react-native-jsoncanvas'
  s.author       = { 'Leslie Owusu-Appiah' => 'leslieoa@pm.me' }
  s.source       = { :git => 'https://github.com/workspace-sh/react-native-jsoncanvas.git', :tag => "v#{s.version}" }

  # macOS-only for now. The Swift class is wrapped in `#if os(macOS)` and the
  # ObjC bridge in `#if TARGET_OS_OSX`, so the same files compile cleanly on
  # iOS as no-ops if/when we add an iOS-supported variant later.
  s.platforms    = { :osx => '11.0' }

  s.source_files = 'ios/**/*.{h,m,mm,swift}'

  s.dependency 'React-Core'
end
