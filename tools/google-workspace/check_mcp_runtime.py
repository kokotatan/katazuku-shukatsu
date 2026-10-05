"""実workspace-mcpを使う隔離試験。Googleへの通信は模擬応答に固定する。"""
import asyncio
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import parse_qs

with tempfile.TemporaryDirectory(prefix='katazuku-mcp-test-') as temporary:
    account = 'person@example.com'
    prefix = 'https://www.googleapis.com/auth/'
    scopes = ['openid'] + [prefix + name for name in ['userinfo.email', 'userinfo.profile', 'gmail.modify',
              'calendar.readonly', 'calendar.events', 'drive.readonly', 'drive.file', 'spreadsheets']]
    endpoint = 'https://katazuku-google.kotalabo.com/token'
    os.environ.update(USER_GOOGLE_EMAIL=account, GOOGLE_OAUTH_CLIENT_ID='123-example.apps.googleusercontent.com',
                      GOOGLE_OAUTH_CLIENT_SECRET='', WORKSPACE_MCP_CREDENTIALS_DIR=temporary,
                      MCP_SINGLE_USER_MODE='1', MCP_ENABLE_OAUTH21='false',
                      KATAZUKU_COMMON_GOOGLE_SCOPES=json.dumps(scopes), KATAZUKU_COMMON_GOOGLE_TOKEN_URI=endpoint)
    stored = dict(token='example-expired', refresh_token='example-refresh', client_id=os.environ['GOOGLE_OAUTH_CLIENT_ID'],
                  client_secret='', token_uri=endpoint, scopes=scopes, expiry='2000-01-01T00:00:00')
    path = Path(temporary) / (account + '.json')
    path.write_text(json.dumps(stored), encoding='utf-8')
    from auth import google_auth, scopes as scope_module, permissions
    from auth.google_auth import GoogleAuthenticationError
    from mcp_runtime import install_common_auth
    calls = []

    class Response:
        status = 200
        data = json.dumps(dict(access_token='example-fresh', expires_in=3600, token_type='Bearer', scope=' '.join(scopes))).encode()
        headers = {}

    def request(url, method, body=None, **kwargs):
        calls.append((url, method, parse_qs(body.decode())))
        assert url == endpoint
        return Response()

    google_auth.Request = lambda: request
    get = install_common_auth()
    result = get(account, [prefix + 'gmail.readonly'], session_id='must-not-reuse-session')
    assert result.token == 'example-fresh'
    assert len(calls) == 1 and calls[0][1] == 'POST'
    assert calls[0][2]['grant_type'] == ['refresh_token']
    assert calls[0][2]['refresh_token'] == ['example-refresh']
    assert set(calls[0][2]['scope'][0].split()) == set(scopes)
    assert set(scope_module.get_current_scopes()) == set(scopes)
    assert permissions.get_scopes_for_permission('gmail', 'katazuku')

    def rejected(callback):
        try:
            callback()
        except GoogleAuthenticationError:
            return
        raise AssertionError('拒否されるべき操作が通りました')

    rejected(lambda: get('someone@example.com', []))
    rejected(lambda: get(account, [prefix + 'gmail.settings.basic']))
    rejected(lambda: google_auth.create_oauth_flow([]))
    rejected(lambda: asyncio.run(google_auth.start_auth_flow()))
    path.write_text(json.dumps({**stored, 'token_uri': 'https://outside.example.test/token'}), encoding='utf-8')
    rejected(lambda: get(account, []))
    path.write_text(json.dumps(stored), encoding='utf-8')
    Response.status = 400
    Response.data = b'{"error":"invalid_grant"}'
    rejected(lambda: get(account, []))
    assert len(calls) == 2
    print('共通MCP実行: 更新トークン・9権限・別アカウント拒否・再認証の固定を検証しました。')
