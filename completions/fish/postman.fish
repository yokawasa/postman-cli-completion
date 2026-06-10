# Fish completion for Postman CLI (postman v1.35.2)
# https://github.com/yokawasa/postman-cli-completion

# Helper: true when no subcommand has been entered yet.
function __postman_no_subcommand
    not __fish_seen_subcommand_from login logout collection api runner spec \
        monitor workspace performance flows fl request sdk mock application app simulate
end

# Helper: true when the parent and sub are both seen but no leaf subcommand yet.
function __postman_using_subcommand
    set -l parent $argv[1]
    set -l leaves $argv[2..]
    __fish_seen_subcommand_from $parent
    and not __fish_seen_subcommand_from $leaves
end

# ---------- Global flags ----------
complete -c postman -s v -l version -d 'Output the version number'
complete -c postman -l silent -d 'Silence all terminal output'
complete -c postman -l color -d 'Enable/disable colored output' -x -a 'auto on off'
complete -c postman -s h -l help -d 'Display help'

# ---------- Top-level commands ----------
complete -c postman -n __postman_no_subcommand -a login       -d 'Authenticate with Postman'
complete -c postman -n __postman_no_subcommand -a logout      -d 'Delete the stored Postman API key'
complete -c postman -n __postman_no_subcommand -a collection  -d 'Run and test Postman collections'
complete -c postman -n __postman_no_subcommand -a api         -d 'Publish and test APIs (US region only)'
complete -c postman -n __postman_no_subcommand -a runner      -d 'Run runners on your own environments'
complete -c postman -n __postman_no_subcommand -a spec        -d 'Lint and validate Specifications'
complete -c postman -n __postman_no_subcommand -a monitor     -d 'Invoke a monitor run and display results'
complete -c postman -n __postman_no_subcommand -a workspace   -d 'Manage workspace resources'
complete -c postman -n __postman_no_subcommand -a performance -d 'Manage performance tests on collections'
complete -c postman -n __postman_no_subcommand -a flows       -d 'Manage and interact with flows'
complete -c postman -n __postman_no_subcommand -a fl          -d 'Alias for flows'
complete -c postman -n __postman_no_subcommand -a request     -d 'Send HTTP requests from the command line'
complete -c postman -n __postman_no_subcommand -a sdk         -d 'Generate and manage SDKs'
complete -c postman -n __postman_no_subcommand -a mock        -d 'Run and manage local mock servers'
complete -c postman -n __postman_no_subcommand -a application -d 'Application-level commands'
complete -c postman -n __postman_no_subcommand -a app         -d 'Alias for application'
complete -c postman -n __postman_no_subcommand -a simulate    -d 'Start mock servers with simulated failures'

# ---------- login ----------
complete -c postman -n '__fish_seen_subcommand_from login' -l alias        -d 'Specify the alias of the API key' -x
complete -c postman -n '__fish_seen_subcommand_from login' -l with-api-key -d 'Specify the API key directly' -x
complete -c postman -n '__fish_seen_subcommand_from login' -l region       -d 'Region (us, eu)' -x -a 'us eu'
complete -c postman -n '__fish_seen_subcommand_from login' -l verbose      -d 'Show detailed error information'

# ---------- logout ----------
complete -c postman -n '__fish_seen_subcommand_from logout' -l alias -d 'Specify the alias of the API key' -x

# ---------- collection ----------
complete -c postman -n '__postman_using_subcommand collection migrate lint run' -a migrate -d 'Migrate a v2.1 collection to v3'
complete -c postman -n '__postman_using_subcommand collection migrate lint run' -a lint    -d 'Run linting on a local v3 collection'
complete -c postman -n '__postman_using_subcommand collection migrate lint run' -a run     -d 'Initiate a Postman collection run'

# collection migrate / lint / run — file arg
complete -c postman -n '__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from collection' -r -k -a '(__fish_complete_suffix .json)'
complete -c postman -n '__fish_seen_subcommand_from lint;    and __fish_seen_subcommand_from collection' -r -k -a '(__fish_complete_suffix .json)'
complete -c postman -n '__fish_seen_subcommand_from run;     and __fish_seen_subcommand_from collection' -r -k -a '(__fish_complete_suffix .json)'

# collection run — flags (most useful subset; see README versioning note)
set -l collrun "__fish_seen_subcommand_from run; and __fish_seen_subcommand_from collection"
complete -c postman -n "$collrun" -s e -l environment    -d 'Postman Environment ID or path' -r
complete -c postman -n "$collrun" -s g -l globals        -d 'Postman Globals file path' -r
complete -c postman -n "$collrun" -s r -l reporters      -d 'Reporters (cli,json,junit,html)' -x -a 'cli json junit html'
complete -c postman -n "$collrun" -s n -l iteration-count -d 'Number of iterations' -x
complete -c postman -n "$collrun" -s d -l iteration-data -d 'Iteration data file (JSON/CSV)' -r
complete -c postman -n "$collrun" -s i                   -d 'Request/folder id, name, or path' -x
complete -c postman -n "$collrun" -l global-var          -d 'Global variable key=value' -x
complete -c postman -n "$collrun" -l env-var             -d 'Environment variable key=value' -x
complete -c postman -n "$collrun" -l integration-id      -d 'Integration id for report' -x
complete -c postman -n "$collrun" -l postman-api-key     -d 'Postman API key' -x
complete -c postman -n "$collrun" -l alias               -d 'API key alias' -x
complete -c postman -n "$collrun" -l bail                -d 'Stop on error'
complete -c postman -n "$collrun" -l ignore-redirects    -d 'Do not follow 3XX redirects'
complete -c postman -n "$collrun" -s x -l suppress-exit-code -d 'Override default exit code'
complete -c postman -n "$collrun" -l silent              -d 'Suppress CLI output'
complete -c postman -n "$collrun" -l disable-unicode     -d 'Replace Unicode symbols with plain text'
complete -c postman -n "$collrun" -l delay-request       -d 'Delay between requests (ms)' -x
complete -c postman -n "$collrun" -l timeout             -d 'Timeout for collection run (ms)' -x
complete -c postman -n "$collrun" -l timeout-request     -d 'Timeout for requests (ms)' -x
complete -c postman -n "$collrun" -l timeout-script      -d 'Timeout for scripts (ms)' -x
complete -c postman -n "$collrun" -l working-dir         -d 'Working directory' -r
complete -c postman -n "$collrun" -l no-insecure-file-read -d 'Disallow reading files outside working dir'
complete -c postman -n "$collrun" -s k -l insecure       -d 'Disable SSL validations'
complete -c postman -n "$collrun" -l ssl-client-cert-list -d 'Client cert configs (JSON)' -r
complete -c postman -n "$collrun" -l ssl-client-cert     -d 'Client certificate (PEM)' -r
complete -c postman -n "$collrun" -l ssl-client-key      -d 'Client cert private key' -r
complete -c postman -n "$collrun" -l ssl-client-passphrase -d 'Client cert passphrase' -x
complete -c postman -n "$collrun" -l ssl-extra-ca-certs  -d 'Extra trusted CA certs (PEM)' -r
complete -c postman -n "$collrun" -l cookie-jar          -d 'Custom cookie jar' -r
complete -c postman -n "$collrun" -l export-cookie-jar   -d 'Export cookie jar after run' -r
complete -c postman -n "$collrun" -l verbose             -d 'Show detailed run information'
complete -c postman -n "$collrun" -l mock                -d 'Start a mock server from manifest' -r
complete -c postman -n "$collrun" -l simulate            -d 'Start mocks with fault-injection scenarios' -r

# ---------- api ----------
complete -c postman -n '__postman_using_subcommand api lint publish' -a lint    -d 'Lint the schema of the given API'
complete -c postman -n '__postman_using_subcommand api lint publish' -a publish -d 'Publish a version of an API'

# ---------- runner ----------
complete -c postman -n '__postman_using_subcommand runner start' -a start -d 'Start a runner'
set -l runstart "__fish_seen_subcommand_from start; and __fish_seen_subcommand_from runner"
complete -c postman -n "$runstart" -l id     -d 'Runner ID' -x
complete -c postman -n "$runstart" -l key    -d 'Runner secret key' -x
complete -c postman -n "$runstart" -l region -d 'Region (us, eu)' -x -a 'us eu'
complete -c postman -n "$runstart" -l proxy  -d 'External proxy URL' -x
complete -c postman -n "$runstart" -l egress-proxy -d 'Enable built-in egress proxy'
complete -c postman -n "$runstart" -l egress-proxy-authz-url -d 'Custom egress proxy auth URL' -x
complete -c postman -n "$runstart" -l ssl-extra-ca-certs -d 'Extra trusted CA certs (PEM)' -r
complete -c postman -n "$runstart" -l metrics -d 'Enable metrics server'
complete -c postman -n "$runstart" -l metrics-port -d 'Metrics server port' -x

# ---------- spec ----------
complete -c postman -n '__postman_using_subcommand spec lint' -a lint -d 'Lint the given specification'
complete -c postman -n '__fish_seen_subcommand_from lint; and __fish_seen_subcommand_from spec' -r -k -a '(__fish_complete_suffix .yaml .yml .json)'

# ---------- monitor ----------
complete -c postman -n '__postman_using_subcommand monitor run' -a run -d 'Invoke a monitor run'

# ---------- workspace ----------
complete -c postman -n '__postman_using_subcommand workspace prepare push' -a prepare -d 'Prepare local resources for push'
complete -c postman -n '__postman_using_subcommand workspace prepare push' -a push    -d 'Push local changes to Postman workspace'

# ---------- performance ----------
complete -c postman -n '__postman_using_subcommand performance run' -a run -d 'Run a performance test'
set -l perfrun "__fish_seen_subcommand_from run; and __fish_seen_subcommand_from performance"
complete -c postman -n "$perfrun" -s e -l environment   -d 'Postman Environment ID' -x
complete -c postman -n "$perfrun" -s g -l globals       -d 'Postman Globals ID' -x
complete -c postman -n "$perfrun" -l vu-count           -d 'Number of virtual users' -x
complete -c postman -n "$perfrun" -s d -l duration      -d 'Duration in minutes' -x
complete -c postman -n "$perfrun" -s p -l load-profile  -d 'Load profile' -x -a 'fixed ramp-up spike peak'
complete -c postman -n "$perfrun" -l data-file          -d 'JSON or CSV data file' -r
complete -c postman -n "$perfrun" -l postman-api-key    -d 'Postman API key' -x
complete -c postman -n "$perfrun" -l pass-if            -d 'Pass condition (e.g. less_than(p95,500))' -x
complete -c postman -n "$perfrun" -l persist-metrics    -d 'Persist run results to cloud'

# ---------- flows ----------
set -l flowsParent "__fish_seen_subcommand_from flows fl"
complete -c postman -n "$flowsParent; and not __fish_seen_subcommand_from list trigger deploy run update list-runs get-run" -a list      -d 'List all flows'
complete -c postman -n "$flowsParent; and not __fish_seen_subcommand_from list trigger deploy run update list-runs get-run" -a trigger   -d 'Trigger a deployed flow'
complete -c postman -n "$flowsParent; and not __fish_seen_subcommand_from list trigger deploy run update list-runs get-run" -a deploy    -d 'Deploy a flow'
complete -c postman -n "$flowsParent; and not __fish_seen_subcommand_from list trigger deploy run update list-runs get-run" -a run       -d 'Run a flow from a file'
complete -c postman -n "$flowsParent; and not __fish_seen_subcommand_from list trigger deploy run update list-runs get-run" -a update    -d 'Update settings for a deployed flow'
complete -c postman -n "$flowsParent; and not __fish_seen_subcommand_from list trigger deploy run update list-runs get-run" -a list-runs -d 'List run history'
complete -c postman -n "$flowsParent; and not __fish_seen_subcommand_from list trigger deploy run update list-runs get-run" -a get-run   -d 'Analyze a specific flow run'
complete -c postman -n "$flowsParent; and __fish_seen_subcommand_from run" -r -k -a '(__fish_complete_suffix .json)'

# ---------- request ----------
complete -c postman -n '__fish_seen_subcommand_from request' -s H -l header   -d 'HTTP header (key:value)' -x
complete -c postman -n '__fish_seen_subcommand_from request' -s d -l body     -d 'Request body content' -x
complete -c postman -n '__fish_seen_subcommand_from request' -s f -l form     -d 'multipart/form-data field key=value' -x
complete -c postman -n '__fish_seen_subcommand_from request' -s e -l environment -d 'Postman Environment file' -r
complete -c postman -n '__fish_seen_subcommand_from request' -l timeout       -d 'Request timeout (ms)' -x
complete -c postman -n '__fish_seen_subcommand_from request' -l redirects-ignore -d 'Do not follow 3XX redirects'
complete -c postman -n '__fish_seen_subcommand_from request' -l redirects-max -d 'Maximum redirects' -x
complete -c postman -n '__fish_seen_subcommand_from request' -l redirects-follow-method -d 'Preserve original HTTP method'
complete -c postman -n '__fish_seen_subcommand_from request' -l redirects-remove-referrer -d 'Remove Referer on redirects'
complete -c postman -n '__fish_seen_subcommand_from request' -l retry         -d 'Retry attempts' -x
complete -c postman -n '__fish_seen_subcommand_from request' -l retry-delay   -d 'Delay between retries (ms)' -x
complete -c postman -n '__fish_seen_subcommand_from request' -l script-pre-request -d 'Pre-request script' -x
complete -c postman -n '__fish_seen_subcommand_from request' -l script-post-request -d 'Post-request script' -x
complete -c postman -n '__fish_seen_subcommand_from request' -s o -l output   -d 'Save response to JSON file' -r
complete -c postman -n '__fish_seen_subcommand_from request' -l verbose       -d 'Show detailed request/response info'
complete -c postman -n '__fish_seen_subcommand_from request' -l response-only -d 'Suppress all output except response body'
complete -c postman -n '__fish_seen_subcommand_from request' -l debug         -d 'Debug mode'

# request first positional: HTTP method
complete -c postman -n '__fish_seen_subcommand_from request; and not __fish_seen_subcommand_from GET POST PUT DELETE PATCH HEAD OPTIONS' -a 'GET POST PUT DELETE PATCH HEAD OPTIONS'

# ---------- sdk ----------
set -l sdkleaves 'init generate build track list ls fetch get connect'
complete -c postman -n "__fish_seen_subcommand_from sdk; and not __fish_seen_subcommand_from $sdkleaves" -a init     -d 'Create/update .postman/config.json'
complete -c postman -n "__fish_seen_subcommand_from sdk; and not __fish_seen_subcommand_from $sdkleaves" -a generate -d 'Generate a new SDK'
complete -c postman -n "__fish_seen_subcommand_from sdk; and not __fish_seen_subcommand_from $sdkleaves" -a build    -d 'Alias for generate'
complete -c postman -n "__fish_seen_subcommand_from sdk; and not __fish_seen_subcommand_from $sdkleaves" -a track    -d 'Enable change tracking for an SDK'
complete -c postman -n "__fish_seen_subcommand_from sdk; and not __fish_seen_subcommand_from $sdkleaves" -a list     -d 'List SDK builds'
complete -c postman -n "__fish_seen_subcommand_from sdk; and not __fish_seen_subcommand_from $sdkleaves" -a ls       -d 'Alias for list'
complete -c postman -n "__fish_seen_subcommand_from sdk; and not __fish_seen_subcommand_from $sdkleaves" -a fetch    -d 'Download SDKs from a build'
complete -c postman -n "__fish_seen_subcommand_from sdk; and not __fish_seen_subcommand_from $sdkleaves" -a get      -d 'Alias for fetch'
complete -c postman -n "__fish_seen_subcommand_from sdk; and not __fish_seen_subcommand_from $sdkleaves" -a connect  -d 'Connect to a Git repo'

set -l sdkgen "__fish_seen_subcommand_from sdk; and __fish_seen_subcommand_from generate build"
complete -c postman -n "$sdkgen" -s l -l languages -d 'Target languages' -x
complete -c postman -n "$sdkgen" -s o -l output    -d 'Output directory' -r
complete -c postman -n "$sdkgen" -l all            -d 'Generate all languages'

complete -c postman -n '__fish_seen_subcommand_from sdk; and __fish_seen_subcommand_from connect' -a 'github gitlab bitbucket'

# ---------- mock ----------
complete -c postman -n '__postman_using_subcommand mock run' -a run -d 'Start a local mock server from manifest'
complete -c postman -n '__fish_seen_subcommand_from mock; and __fish_seen_subcommand_from run' -r -k -a '(__fish_complete_suffix .json)'

# ---------- application ----------
set -l appparent "__fish_seen_subcommand_from application app"
complete -c postman -n "$appparent; and not __fish_seen_subcommand_from init test" -a init -d 'Initialise postman.config.cjs'
complete -c postman -n "$appparent; and not __fish_seen_subcommand_from init test" -a test -d 'Run a command and match captured traffic'

# ---------- simulate ----------
complete -c postman -n '__postman_using_subcommand simulate run' -a run -d 'Start mocks with fault-injection scenarios'
complete -c postman -n '__fish_seen_subcommand_from simulate; and __fish_seen_subcommand_from run' -r -k -a '(__fish_complete_suffix .yaml .yml .json)'
