let
  pkgs = import <nixpkgs> { config.allowUnfree = true; };
  sandbox =
    import (fetchTarball "https://github.com/archie-judd/agent-sandbox.nix/archive/main.tar.gz")
      {
        pkgs = pkgs;
      };
  devPackages = [
    pkgs.nodejs
    (pkgs.python3.withPackages (ps: with ps; [ pyyaml ]))
    pkgs.prettier
  ];
  claude-sandboxed = sandbox.mkSandbox {
    pkg = pkgs.claude-code;
    binName = "claude";
    outName = "claude-sandboxed";
    allowedPackages = [
      pkgs.coreutils
      pkgs.which
      pkgs.git
      pkgs.less
      pkgs.ripgrep
      pkgs.fd
      pkgs.gnused
      pkgs.gnugrep
      pkgs.findutils
      pkgs.jq
    ]
    ++ devPackages;
    rwDirs = [ "$HOME/.claude" ];
    roFiles = [ "$HOME/.config/git/config" ];
    env = {
      EDITOR = "nvim";
      COLORTERM = "truecolor";
      CLAUDE_CONFIG_DIR = "$CLAUDE_CONFIG_DIR";
      GH_TOKEN = "$(${pkgs.coreutils}/bin/cat $SOPS_DECRYPTED_DIR/github-read-token)";
    }
    // pkgs.lib.optionalAttrs pkgs.stdenv.isDarwin {
      CLAUDE_CODE_OAUTH_TOKEN = "$(${pkgs.coreutils}/bin/cat $SOPS_DECRYPTED_DIR/claude-code-oauth-token)";
    };
    allowedDomains = {
      "anthropic.com" = "*";
      "claude.com" = "*";
      "github.com" = "*";
      "githubusercontent.com" = [
        "GET"
        "HEAD"
      ];
      "registry.npmjs.org" = [
        "GET"
        "HEAD"
      ];
      "nodejs.org" = [
        "GET"
        "HEAD"
      ];
    };
  };

in
pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs
    (pkgs.python3.withPackages (ps: with ps; [ pyyaml ]))
    pkgs.prettier
    claude-sandboxed
  ];
}
