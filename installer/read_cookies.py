import sqlite3, json, base64, sys, os, ctypes, ctypes.wintypes

cookies_path = sys.argv[1] if len(sys.argv) > 1 else ''
local_state_path = sys.argv[2] if len(sys.argv) > 2 else ''

if not cookies_path or not os.path.exists(cookies_path):
    print(json.dumps({'error': 'Cookies file not found: ' + cookies_path}))
    sys.exit(0)

key = None
try:
    with open(local_state_path, 'r', encoding='utf-8') as f:
        ls = json.load(f)
    encrypted_key_b64 = ls.get('os_crypt', {}).get('encrypted_key', '')
    if encrypted_key_b64:
        encrypted_key = base64.b64decode(encrypted_key_b64)
        if encrypted_key[:5] == b'DPAPI':
            encrypted_key = encrypted_key[5:]
        class DATA_BLOB(ctypes.Structure):
            _fields_ = [('cbData', ctypes.wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]
        blob_in = DATA_BLOB(len(encrypted_key), ctypes.create_string_buffer(encrypted_key, len(encrypted_key)))
        blob_out = DATA_BLOB()
        if ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
            key = ctypes.string_at(blob_out.pbData, blob_out.cbData)
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
except Exception as e:
    pass

cookies = []
try:
    conn = sqlite3.connect(cookies_path)
    conn.text_factory = str
    cur = conn.cursor()
    cur.execute('SELECT host_key, name, encrypted_value, path, is_secure, is_httponly, expires_utc, samesite FROM cookies')
    for row in cur.fetchall():
        host, name, enc_value, path_val, secure, httponly, expires, samesite = row
        value = ''
        if enc_value and len(enc_value) > 0:
            prefix = enc_value[:3] if len(enc_value) >= 3 else b''
            if prefix in (b'v10', b'v20') and key:
                try:
                    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
                    nonce = enc_value[3:15]
                    ciphertext_with_tag = enc_value[15:]
                    aesgcm = AESGCM(key)
                    value = aesgcm.decrypt(nonce, ciphertext_with_tag, None).decode('utf-8', errors='replace')
                except Exception:
                    value = ''
            else:
                try:
                    value = enc_value.decode('utf-8', errors='replace')
                except Exception:
                    value = ''
        if value:
            same_site_map = {0: 'unspecified', 1: 'no_restriction', 2: 'lax', 3: 'strict'}
            cookies.append({
                'domain': host,
                'name': name,
                'value': value,
                'path': path_val or '/',
                'secure': bool(secure),
                'httpOnly': bool(httponly),
                'expires': expires if expires and expires > 0 else 0,
                'sameSite': same_site_map.get(samesite, 'unspecified')
            })
    conn.close()
except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(0)

print(json.dumps(cookies, ensure_ascii=False))
