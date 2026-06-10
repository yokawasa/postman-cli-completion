# Bash completion for Postman CLI (postman v1.35.2)
# https://github.com/yokawasa/postman-cli-completion
#
# Install:
#   source /path/to/postman.bash
# Or copy into /usr/local/etc/bash_completion.d/ (Homebrew) or
# /etc/bash_completion.d/ (Linux).

_postman_filematch() {
  # $1 = extglob pattern, e.g. '!*.@(json|yaml|yml)'
  local cur="$2"
  COMPREPLY=( $(compgen -f -X "$1" -- "$cur") )
  # Also include directories for navigation.
  COMPREPLY+=( $(compgen -d -- "$cur") )
}

_postman() {
  local cur prev words cword
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  local top_commands="login logout collection api runner spec monitor workspace performance flows fl request sdk mock application app simulate"
  local global_flags="-v --version --silent --color -h --help"

  # Find the position of the first non-flag word (the subcommand).
  local i cmd="" subcmd="" cmd_idx=0 subcmd_idx=0
  for ((i=1; i<COMP_CWORD; i++)); do
    case "${COMP_WORDS[i]}" in
      -*) continue ;;
    esac
    if [[ -z "$cmd" ]]; then
      cmd="${COMP_WORDS[i]}"; cmd_idx=$i
    elif [[ -z "$subcmd" ]]; then
      subcmd="${COMP_WORDS[i]}"; subcmd_idx=$i
      break
    fi
  done

  # No subcommand chosen yet: complete top-level commands or global flags.
  if [[ -z "$cmd" ]]; then
    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
    else
      COMPREPLY=( $(compgen -W "$top_commands" -- "$cur") )
    fi
    return 0
  fi

  # Dispatch by top-level command.
  case "$cmd" in
    login)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--alias --with-api-key --region --verbose -h --help" -- "$cur") )
      elif [[ "$prev" == "--region" ]]; then
        COMPREPLY=( $(compgen -W "us eu" -- "$cur") )
      fi
      ;;
    logout)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--alias -h --help" -- "$cur") )
      fi
      ;;
    collection)
      _postman_collection
      ;;
    api)
      _postman_api
      ;;
    runner)
      _postman_runner
      ;;
    spec)
      _postman_spec
      ;;
    monitor)
      _postman_monitor
      ;;
    workspace)
      if [[ -z "$subcmd" ]]; then
        COMPREPLY=( $(compgen -W "prepare push" -- "$cur") )
      else
        [[ "$cur" == -* ]] && COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
      fi
      ;;
    performance)
      _postman_performance
      ;;
    flows|fl)
      _postman_flows
      ;;
    request)
      _postman_request
      ;;
    sdk)
      _postman_sdk
      ;;
    mock)
      _postman_mock
      ;;
    application|app)
      if [[ -z "$subcmd" ]]; then
        COMPREPLY=( $(compgen -W "init test" -- "$cur") )
      else
        [[ "$cur" == -* ]] && COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
      fi
      ;;
    simulate)
      if [[ -z "$subcmd" ]]; then
        COMPREPLY=( $(compgen -W "run" -- "$cur") )
      elif [[ "$subcmd" == "run" ]]; then
        if [[ "$cur" == -* ]]; then
          COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
        else
          _postman_filematch '!*.@(yaml|yml|json)' "$cur"
        fi
      fi
      ;;
  esac
}

_postman_collection() {
  if [[ -z "$subcmd" ]]; then
    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
    else
      COMPREPLY=( $(compgen -W "migrate lint run" -- "$cur") )
    fi
    return
  fi

  case "$subcmd" in
    migrate|lint)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
      else
        _postman_filematch '!*.@(json)' "$cur"
      fi
      ;;
    run)
      local flags="-e --environment -g --globals -r --reporters \
        --reporter-json-export --reporter-junit-export --reporter-html-export \
        --reporter-json-structure \
        --reporter-json-omitRequestBodies --reporter-json-omitResponseBodies \
        --reporter-json-omitHeaders --reporter-json-omitAllHeadersAndBody \
        --reporter-html-omitRequestBodies --reporter-html-omitResponseBodies \
        --reporter-html-omitHeaders --reporter-html-omitAllHeadersAndBody \
        -n --iteration-count -d --iteration-data -i \
        --global-var --env-var --integration-id --postman-api-key --alias \
        --bail --ignore-redirects -x --suppress-exit-code --silent \
        --disable-unicode --delay-request --timeout --timeout-request \
        --timeout-script --working-dir --no-insecure-file-read \
        -k --insecure --ssl-client-cert-list --ssl-client-cert \
        --ssl-client-key --ssl-client-passphrase --ssl-extra-ca-certs \
        --cookie-jar --export-cookie-jar --verbose --mock --simulate \
        -h --help"
      case "$prev" in
        -e|--environment|-g|--globals|--mock|--cookie-jar|--ssl-client-cert-list)
          _postman_filematch '!*.@(json)' "$cur" ; return ;;
        -d|--iteration-data)
          _postman_filematch '!*.@(json|csv)' "$cur" ; return ;;
        --ssl-client-cert|--ssl-extra-ca-certs)
          _postman_filematch '!*.@(pem|crt|cer)' "$cur" ; return ;;
        --ssl-client-key)
          _postman_filematch '!*.@(pem|key)' "$cur" ; return ;;
        --simulate)
          _postman_filematch '!*.@(yaml|yml)' "$cur" ; return ;;
        --working-dir)
          COMPREPLY=( $(compgen -d -- "$cur") ) ; return ;;
        --reporter-json-export|--reporter-junit-export|--reporter-html-export|--export-cookie-jar)
          COMPREPLY=( $(compgen -f -- "$cur") ) ; return ;;
        -r|--reporters)
          COMPREPLY=( $(compgen -W "cli json junit html" -- "$cur") ) ; return ;;
        --reporter-json-structure)
          COMPREPLY=( $(compgen -W "newman" -- "$cur") ) ; return ;;
      esac
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
      else
        _postman_filematch '!*.@(json)' "$cur"
      fi
      ;;
  esac
}

_postman_api() {
  if [[ -z "$subcmd" ]]; then
    COMPREPLY=( $(compgen -W "lint publish" -- "$cur") )
  else
    [[ "$cur" == -* ]] && COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
  fi
}

_postman_runner() {
  if [[ -z "$subcmd" ]]; then
    COMPREPLY=( $(compgen -W "start" -- "$cur") )
    return
  fi
  if [[ "$subcmd" == "start" ]]; then
    case "$prev" in
      --region) COMPREPLY=( $(compgen -W "us eu" -- "$cur") ); return ;;
      --ssl-extra-ca-certs) _postman_filematch '!*.@(pem|crt)' "$cur"; return ;;
    esac
    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W "--id --key --region --proxy --egress-proxy --egress-proxy-authz-url --ssl-extra-ca-certs --metrics --metrics-port -h --help" -- "$cur") )
    fi
  fi
}

_postman_spec() {
  if [[ -z "$subcmd" ]]; then
    COMPREPLY=( $(compgen -W "lint" -- "$cur") )
  elif [[ "$subcmd" == "lint" ]]; then
    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
    else
      _postman_filematch '!*.@(yaml|yml|json)' "$cur"
    fi
  fi
}

_postman_monitor() {
  if [[ -z "$subcmd" ]]; then
    COMPREPLY=( $(compgen -W "run" -- "$cur") )
  else
    [[ "$cur" == -* ]] && COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
  fi
}

_postman_performance() {
  if [[ -z "$subcmd" ]]; then
    COMPREPLY=( $(compgen -W "run" -- "$cur") )
    return
  fi
  if [[ "$subcmd" == "run" ]]; then
    case "$prev" in
      -p|--load-profile) COMPREPLY=( $(compgen -W "fixed ramp-up spike peak" -- "$cur") ); return ;;
      --data-file) _postman_filematch '!*.@(json|csv)' "$cur"; return ;;
    esac
    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W "-e --environment -g --globals --vu-count -d --duration -p --load-profile --data-file --postman-api-key --pass-if --persist-metrics -h --help" -- "$cur") )
    fi
  fi
}

_postman_flows() {
  if [[ -z "$subcmd" ]]; then
    COMPREPLY=( $(compgen -W "list trigger deploy run update list-runs get-run" -- "$cur") )
    return
  fi
  if [[ "$subcmd" == "run" && "$cur" != -* ]]; then
    _postman_filematch '!*.@(json)' "$cur"; return
  fi
  [[ "$cur" == -* ]] && COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
}

_postman_request() {
  case "$prev" in
    -e|--environment)
      _postman_filematch '!*.@(json)' "$cur"; return ;;
    -o|--output)
      COMPREPLY=( $(compgen -f -- "$cur") ); return ;;
  esac

  # Special handling for the first positional: HTTP method or URL.
  if [[ $((COMP_CWORD - cmd_idx)) -eq 1 && "$cur" != -* ]]; then
    COMPREPLY=( $(compgen -W "GET POST PUT DELETE PATCH HEAD OPTIONS" -- "$cur") )
    return
  fi

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "-H --header -d --body -f --form -e --environment \
      --timeout --redirects-ignore --redirects-max --redirects-follow-method \
      --redirects-remove-referrer --retry --retry-delay \
      --script-pre-request --script-post-request \
      -o --output --verbose --response-only --debug -h --help" -- "$cur") )
  fi
}

_postman_sdk() {
  if [[ -z "$subcmd" ]]; then
    COMPREPLY=( $(compgen -W "init generate build track list ls fetch get connect" -- "$cur") )
    return
  fi
  case "$subcmd" in
    generate|build)
      case "$prev" in
        -o|--output) COMPREPLY=( $(compgen -d -- "$cur") ); return ;;
      esac
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "-l --languages -o --output --all -h --help" -- "$cur") )
      else
        COMPREPLY=( $(compgen -f -- "$cur") )
      fi
      ;;
    connect)
      if [[ $((COMP_CWORD - subcmd_idx)) -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "github gitlab bitbucket" -- "$cur") )
      fi
      ;;
    *)
      [[ "$cur" == -* ]] && COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
      ;;
  esac
}

_postman_mock() {
  if [[ -z "$subcmd" ]]; then
    COMPREPLY=( $(compgen -W "run" -- "$cur") )
    return
  fi
  if [[ "$subcmd" == "run" ]]; then
    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W "-h --help" -- "$cur") )
    else
      _postman_filematch '!*.@(json)' "$cur"
    fi
  fi
}

# Enable extglob for the @() pattern used in -X filters.
shopt -s extglob 2>/dev/null

complete -F _postman postman
