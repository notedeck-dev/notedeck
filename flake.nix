{
  description = "NoteDeck - Misskey deck client";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      # home-manager module: notemaid を user unit として常駐させる (#1106)。unit の中身は
      # crates/notemaid/deploy/notemaid.service と同じ意味 (再起動しない終了コードは exit.rs)。
      # Nix ではアプリの `service install` は unit を書かず、この module の unit をそのまま使う
      notemaidModule = { config, lib, pkgs, ... }:
        let cfg = config.services.notemaid;
        in {
          options.services.notemaid = {
            enable = lib.mkEnableOption "NoteDeck AI process (notemaid)";
            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.notemaid;
              defaultText = lib.literalExpression "notedeck.packages.\${system}.notemaid";
              description = "notemaid のパッケージ。アプリと同じ版でなければ繋げない";
            };
            api = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "公開 API 面 (localhost の HTTP、REST + SSE) も bind する";
            };
            extraArgs = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [ ];
              description = "notemaid run に渡す追加の引数";
            };
          };
          config = lib.mkIf cfg.enable {
            systemd.user.services.notemaid = {
              Unit = {
                Description = "NoteDeck resident core (notemaid)";
                Documentation = "https://github.com/notedeck-dev/notedeck/issues/1106";
                StartLimitIntervalSec = 300;
                StartLimitBurst = 5;
              };
              Service = {
                Type = "simple";
                ExecStart = lib.escapeShellArgs ([ "${cfg.package}/bin/notemaid" "run" ]
                  ++ lib.optional cfg.api "--api" ++ cfg.extraArgs);
                Restart = "on-failure";
                RestartSec = 5;
                # exit.rs の NO_RESTART: ロック衝突 / DB がバイナリより新しい / runtime dir 不在 / secret の鍵
                RestartPreventExitStatus = "10 11 12 13";
                KillSignal = "SIGTERM";
                TimeoutStopSec = 10;
                NoNewPrivileges = true;
                UMask = "0077";
                RestrictAddressFamilies = "AF_UNIX AF_INET AF_INET6";
              };
              Install.WantedBy = [ "default.target" ];
            };
          };
        };
    in
    {
      homeManagerModules = {
        notemaid = notemaidModule;
        default = notemaidModule;
      };
    } // flake-utils.lib.eachDefaultSystem (system:
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

        # 配布 (#1106 段階 3a): notemaid (AI (notemaid)) と notecli (CLI) を flake の
        # packages として出す。どちらも Tauri 非依存の純 Rust なので WebKit 等は要らない。
        # `nix profile install github:notedeck-dev/notedeck#notemaid` で ~/.nix-profile/bin に
        # 安定したパスで入り、`notemaid service install --exec-path ~/.nix-profile/bin/notemaid`
        # で user unit を用意できる (/nix/store の実パスは GC で消えうるので unit に書かない)。
        # ソースは Rust のワークスペースに要るものだけ (node_modules / target / dist / site は除く)
        rustSource = pkgs.lib.cleanSourceWith {
          src = ./.;
          filter = path: type:
            let base = baseNameOf path;
            in !(builtins.elem base [ "node_modules" "target" "dist" "site" ".direnv" ]);
        };
        workspaceVersion = (builtins.fromTOML (builtins.readFile ./src-tauri/Cargo.toml)).package.version;
        rustCrate = { pname, description }:
          pkgs.rustPlatform.buildRustPackage {
            inherit pname;
            version = workspaceVersion;
            src = rustSource;
            cargoLock.lockFile = ./Cargo.lock;
            cargoBuildFlags = [ "-p" pname ];
            # テストはワークスペースの CI が回す。ここは配布物を作るだけ
            doCheck = false;
            nativeBuildInputs = with pkgs; [ pkg-config ];
            meta = {
              inherit description;
              homepage = "https://github.com/notedeck-dev/notedeck";
              license = pkgs.lib.licenses.agpl3Plus;
              mainProgram = pname;
              platforms = pkgs.lib.platforms.linux ++ pkgs.lib.platforms.darwin;
            };
          };

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
        packages = {
          notemaid = rustCrate {
            pname = "notemaid";
            description = "NoteDeck resident core daemon (headless notecore)";
          };
          notecli = rustCrate {
            pname = "notecli";
            description = "Misskey CLI from NoteDeck";
          };
          default = self.packages.${system}.notemaid;
        };

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
