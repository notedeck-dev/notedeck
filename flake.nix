{
  description = "NoteDeck - Misskey deck client";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        androidEnv = pkgs.androidenv.override { licenseAccepted = true; };
        androidComposition = androidEnv.composeAndroidPackages {
          platformVersions = [ "36" ];
          buildToolsVersions = [ "35.0.0" "36.0.0" ];
          includeNDK = true;
          ndkVersions = [ "27.0.12077973" ];
          includeEmulator = false;
        };
        androidSdk = androidComposition.androidsdk;
        androidHome = "${androidSdk}/libexec/android-sdk";

        desktopDeps = with pkgs; [
          openssl
          gtk3
          webkitgtk_4_1
          libayatana-appindicator
          librsvg
          glib-networking
        ];

        commonPackages = with pkgs; [
          # Node.js
          nodejs_24
          pnpm_11

          # Rust
          # (rust-analyzer / rust-src は rust-toolchain.toml の components で入る)
          rustup

          # Language servers — devShell に入った時点で
          # どのエディタでも補完・定義ジャンプが動く状態にする (#896)
          taplo # TOML (Cargo.toml, rust-toolchain.toml)
          nil # Nix (flake.nix)
          vue-language-server # Vue SFC (TypeScript は node_modules の版を使う)

          # GitHub Actions ワークフローの静的検査。
          # CI を壊したことを push して 10 分待ってから知る、を避ける
          actionlint

          # Tauri desktop dependencies (Linux)
          pkg-config
        ] ++ desktopDeps;

        commonEnv = {
          # WSL2: WebKitGTK EGL workaround (software rendering fallback)
          WEBKIT_DISABLE_DMABUF_RENDERER = "1";
          LIBGL_ALWAYS_SOFTWARE = "1";
        };

        commonShellHook = ''
          export LANG="C.UTF-8"
          export GIO_EXTRA_MODULES="${pkgs.glib-networking}/lib/gio/modules"
          export GST_PLUGIN_SYSTEM_PATH_1_0="${pkgs.gst_all_1.gstreamer}/lib/gstreamer-1.0:${pkgs.gst_all_1.gst-plugins-base}/lib/gstreamer-1.0:${pkgs.gst_all_1.gst-plugins-good}/lib/gstreamer-1.0"
          export __EGL_VENDOR_LIBRARY_FILENAMES="${pkgs.mesa}/share/glvnd/egl_vendor.d/50_mesa.json"
          export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath (desktopDeps ++ (with pkgs; [
            gdk-pixbuf
            pango
            cairo
            glib
            atk
            harfbuzz
            libsoup_3
            libx11
            libxcb
            libxext
            libxrender
            libGL
            dbus
            gst_all_1.gstreamer
            gst_all_1.gst-plugins-base
            gst_all_1.gst-plugins-good
          ]))}:$LD_LIBRARY_PATH"
        '';
      in
      {
        devShells = {
          # デスクトップ開発用（direnv / `nix develop` はこれ）。
          # Android SDK/NDK は store に 2.7GB 積むため入れない。
          default = pkgs.mkShell (commonEnv // {
            buildInputs = commonPackages;
            shellHook = commonShellHook;
          });

          # Android ビルド用: `nix develop .#android`
          # (`pnpm tauri android dev` / `build` を叩くときだけ入る)
          android = pkgs.mkShell (commonEnv // {
            buildInputs = commonPackages ++ (with pkgs; [ jdk17 androidSdk ]);

            JAVA_HOME = "${pkgs.jdk17}";
            ANDROID_HOME = androidHome;
            ANDROID_SDK_ROOT = androidHome;
            NDK_HOME = "${androidHome}/ndk/27.0.12077973";
            GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidHome}/build-tools/36.0.0/aapt2";

            shellHook = commonShellHook + ''
              export PATH="${androidHome}/platform-tools:$PATH"
            '';
          });
        };
      }
    );
}
