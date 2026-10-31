// swift-tools-version:5.9
//
// RevenueCat as a PREBUILT binary rather than a source package. Copied from
// dayGLANCE (dayglance-ios/Packages/RevenueCatBinary) and lastGLANCE, URL and
// checksum unchanged. The platform floor is iOS 16, this app's deployment
// target (IPHONEOS_DEPLOYMENT_TARGET), the same as dayGLANCE's.
//
// Xcode 27's Swift 6.4 fails to compile purchases-ios from source: whole-
// module overload resolution rejects PaywallColor's initializers ("Invalid
// redeclaration of synthesized memberwise init", "Ambiguous use of 'init'"),
// in every 5.x release, on code we never call. It is a compiler regression,
// tracked at https://github.com/RevenueCat/purchases-ios/issues/7730, and
// an older Xcode cannot be launched on the macOS that ships with 27.
//
// Every RevenueCat release attaches RevenueCat.xcframework.zip, built with
// library evolution, so its .swiftinterface files are what the app's
// compiler reads. The interface declares PaywallColor's one public init
// and nothing that could be ambiguous, so the binary links where the
// source does not. The app only imports RevenueCat (not RevenueCatUI).
//
// To bump: change the version in the URL and replace the checksum with the
// SHA-256 of the new zip (`swift package compute-checksum <zip>`, or
// `shasum -a 256`). Bump it together with dayGLANCE's and lastGLANCE's copies. To go back to the
// source package once the compiler or the SDK is fixed, add
// https://github.com/RevenueCat/purchases-ios-spm to the App target in Xcode
// and delete this directory.
import PackageDescription

let package = Package(
    name: "RevenueCatBinary",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "RevenueCat", targets: ["RevenueCat"]),
    ],
    targets: [
        .binaryTarget(
            name: "RevenueCat",
            url: "https://github.com/RevenueCat/purchases-ios/releases/download/5.90.1/RevenueCat.xcframework.zip",
            checksum: "ad2473b9a355facb7d4e33fa75679b6b089d11e876d97d0243198271a1fa7233"
        ),
    ]
)
