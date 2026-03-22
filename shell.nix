let
  pkgs = import <nixpkgs> { config.allowUnfree = true; };
  sandbox = import (fetchTarball
    "https://github.com/archie-judd/agent-sandbox.nix/archive/main.tar.gz") {
      pkgs = pkgs;
    };
  devPackages = [
    pkgs.nodejs
    (pkgs.python3.withPackages (ps: with ps; [ pyyaml ]))
    pkgs.nodePackages.prettier
  ];
  claude-sandboxed = sandbox.mkSandbox {
    pkg = pkgs.claude-code;
    binName = "claude";
    outName = "claude";
    allowedPackages = [
      pkgs.coreutils
      pkgs.which
      pkgs.git
      pkgs.ripgrep
      pkgs.fd
      pkgs.gnused
      pkgs.gnugrep
      pkgs.findutils
      pkgs.jq
    ] ++ devPackages;
    stateDirs = [ "$HOME/.claude" ];
    stateFiles = [ "$HOME/.claude.json" "$HOME/.claude.json.lock" ];
    extraEnv = {
      # Use literal strings for secrets to evaluate at runtime!
      # builtins.getEnv will leak your token into the /nix/store.
      CLAUDE_CODE_OAUTH_TOKEN =
        "$(${pkgs.coreutils}/bin/cat $HOME/.config/sops-nix/secrets/claude-code-oauth-token)";
      EDITOR = "nvim";
    };
    restrictNetwork = true;
    allowedDomains = [
      # Anthropic
      "anthropic.com"
      "claude.com"
      # GitHub
      "raw.githubusercontent.com"
      "api.github.com"
      # Node
      "registry.npmjs.org"
      "nodejs.org"
    ];
  };

in pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs
    (pkgs.python3.withPackages (ps: with ps; [ pyyaml ]))
    pkgs.nodePackages.prettier
    claude-sandboxed
  ];
}
