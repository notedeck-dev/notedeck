{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        notecli = pkgs.rustPlatform.buildRustPackage {
          pname = "notecli";
          version = (pkgs.lib.importTOML ./Cargo.toml).package.version;
          src = ./.;
          # Cargo.lock から依存を決定的に解決する。
          # 依存を追加してもハッシュ手動更新は不要 (cargoHash 方式の破綻を回避)。
          cargoLock.lockFile = ./Cargo.lock;
          nativeBuildInputs = with pkgs; [ pkg-config ];
          buildInputs =
            with pkgs;
            [ openssl ]
            ++ lib.optionals stdenv.hostPlatform.isDarwin [
              darwin.apple_sdk.frameworks.Security
              darwin.apple_sdk.frameworks.SystemConfiguration
            ];
          buildNoDefaultFeatures = true;
        };
      in
      {
        packages.default = notecli;

        devShells.default = pkgs.mkShell {
          inputsFrom = [ notecli ];
          packages = with pkgs; [
            rust-analyzer
            clippy
          ];
        };
      }
    );
}
