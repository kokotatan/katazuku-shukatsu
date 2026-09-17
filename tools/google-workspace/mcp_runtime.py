"""共通認証用の隔離アダプター。インストール済みworkspace-mcpを変更しない。"""
import json
import os
import sys
from importlib.metadata import version
from pathlib import Path


def install_common_auth():
    if version('workspace-mcp') != '1.23.0':
        raise RuntimeError('検証済みのworkspace-mcp 1.23.0を使用してください。')

    from auth import scopes as scope_module
    from auth import permissions, google_auth
    from auth.google_auth import GoogleAuthenticationError

    account = os.environ['USER_GOOGLE_EMAIL']
    client_id = os.environ['GOOGLE_OAUTH_CLIENT_ID']
    token_uri = os.environ['KATAZUKU_COMMON_GOOGLE_TOKEN_URI']
    scopes = json.loads(os.environ['KATAZUKU_COMMON_GOOGLE_SCOPES'])
    directory = Path(os.environ['WORKSPACE_MCP_CREDENTIALS_DIR']).resolve()
    credential = directory / (account + '.json')
    if credential.resolve().parent != directory:
        raise RuntimeError('Google接続の保存先が不正です。')
    reconnect = ('共通Google接続を再認証してください。google:connect に --account ' + account
                 + ' と --replace を指定し、--credentials-dir には次の保存先を指定してください: ' + str(directory))

    def require_common_file():
        try:
            saved = json.loads(credential.read_text(encoding='utf-8'))
            valid = (saved.get('client_id') == client_id and saved.get('client_secret') == ''
                     and saved.get('token_uri') == token_uri and bool(saved.get('refresh_token'))
                     and set(saved.get('scopes', [])) == set(scopes))
        except (OSError, ValueError, TypeError):
            valid = False
        if not valid:
            raise GoogleAuthenticationError(reconnect)

    require_common_file()
    original_get = google_auth.get_credentials

    def get_credentials(user_google_email, required_scopes, *args, **kwargs):
        if user_google_email != account:
            raise GoogleAuthenticationError('接続先と異なるGoogleアカウントは利用できません。')
        if not scope_module.has_required_scopes(scopes, required_scopes):
            raise GoogleAuthenticationError('この機能は共通Google接続の9権限に含まれていません。')
        require_common_file()
        # セッションに別クライアントの資格情報が残っていても読み込まない。
        kwargs['session_id'] = None
        result = original_get(user_google_email, required_scopes, *args, **kwargs)
        if result is None:
            raise GoogleAuthenticationError(reconnect)
        if (result.client_id != client_id or result.token_uri != token_uri
                or result.client_secret != '' or set(result.scopes or []) != set(scopes)):
            raise GoogleAuthenticationError('共通接続と異なる資格情報が返されました。')
        return result

    async def start_auth_flow(*args, **kwargs):
        raise GoogleAuthenticationError(reconnect)

    def create_oauth_flow(*args, **kwargs):
        raise GoogleAuthenticationError(reconnect)

    google_auth.get_credentials = get_credentials
    google_auth.start_auth_flow = start_auth_flow
    google_auth.create_oauth_flow = create_oauth_flow

    # ツールを権限単位で絞る。上位権限に含まれる読み取り・下書き等は利用できる。
    profiles = {
        'gmail': [scope_module.GMAIL_MODIFY_SCOPE, scope_module.GMAIL_READONLY_SCOPE,
                  scope_module.GMAIL_LABELS_SCOPE, scope_module.GMAIL_COMPOSE_SCOPE, scope_module.GMAIL_SEND_SCOPE],
        'calendar': [scope_module.CALENDAR_READONLY_SCOPE, scope_module.CALENDAR_EVENTS_SCOPE],
        'drive': [scope_module.DRIVE_READONLY_SCOPE, scope_module.DRIVE_FILE_SCOPE],
        'sheets': [scope_module.SHEETS_READONLY_SCOPE, scope_module.SHEETS_WRITE_SCOPE, scope_module.DRIVE_READONLY_SCOPE],
    }
    for service, allowed in profiles.items():
        permissions.SERVICE_PERMISSION_LEVELS[service] = [('katazuku', allowed)]
    # 再認証を要求する経路でも、申請するOAuthスコープは9個から増やさない。
    scope_module.get_scopes_for_tools = lambda enabled_tools=None: list(scopes)
    scope_module.SCOPES = list(scopes)
    return get_credentials


if __name__ == '__main__':
    try:
        install_common_auth()
        from main import main
        sys.argv = ['workspace-mcp', '--transport', 'stdio', '--single-user', '--permissions',
                    'gmail:katazuku', 'calendar:katazuku', 'drive:katazuku', 'sheets:katazuku']
        main()
    except Exception:
        print('共通Google接続の起動に失敗しました。接続を確認して再実行してください。', file=sys.stderr)
        sys.exit(1)
