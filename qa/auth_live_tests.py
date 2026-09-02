"""Live auth/session tests for CHOME dev (host.docker.internal:3001).
Isolates rate-limit buckets via spoofed cf-connecting-ip to avoid locking
the shared 'unresolved' bucket. All accounts QA_AUTH_* are throwaway.
"""
import json
import time
import requests

BASE = "http://host.docker.internal:3001"

def mk(ip: str | None = None):
    s = requests.Session()
    s.trust_env = False
    if ip:
        s.headers["cf-connecting-ip"] = ip
    return s

def csrf(s):
    r = s.get(f"{BASE}/api/auth/csrf", timeout=10)
    return r.json().get("csrfToken")

def login(s, email, password):
    token = csrf(s)
    r = s.post(
        f"{BASE}/api/auth/callback/credentials",
        data={
            "csrfToken": token,
            "email": email,
            "password": password,
            "callbackUrl": f"{BASE}/dashboard",
            "json": "true",
        },
        allow_redirects=False,
        timeout=15,
    )
    return r

def describe_login(r):
    loc = r.headers.get("location", "")
    if r.status_code == 302 and "error=" in loc:
        return f"302 err={loc.split('error=')[-1][:40]}"
    if r.status_code == 302:
        return f"302 -> {loc[:70]}"
    return f"{r.status_code} {r.text[:200]}"

def cookie_flags(s):
    flags = {}
    for c in s.cookies:
        flags[c.name] = {
            "secure": c.secure,
            "httponly": c.has_nonstandard_attr("HttpOnly") or c._rest.get("HttpOnly"),
            "samesite": c._rest.get("SameSite"),
            "domain": c.domain,
            "path": c.path,
        }
    return flags

results = []

def rec(name, detail):
    results.append((name, detail))
    print(f"[{name}] {detail}")

# --- Test A: admin login works, capture cookie flags ---
s = mk()
r = login(s, "allopze@gmail.com", "Chgo1314")
rec("A_admin_login", describe_login(r))
rec("A_cookie_flags", json.dumps(cookie_flags(s), indent=1))
sr = s.get(f"{BASE}/api/auth/session", timeout=10)
rec("A_session", sr.text[:200])

# --- Test B: wrong password -> generic error (no enumeration) ---
s2 = mk("203.0.113.10")
r2 = login(s2, "qa_auth_nonexistent@example.com", "WrongPass123!")
rec("B_wrong_creds", describe_login(r2))

# --- Test C/D: rate limit per-IP with spoofed header ---
for i in range(5):
    s3 = mk("203.0.113.20")
    r3 = login(s3, "qa_auth_rate@example.com", f"bad{i}")
rec("C_5_failures_same_ip", "sent 5 failed logins from 203.0.113.20")
s4 = mk("203.0.113.20")
r4 = login(s4, "qa_auth_rate@example.com", "bad6")
rec("C_6th_same_ip", describe_login(r4))

# Rotate IP, same email -> email bucket should still be locked
s5 = mk("203.0.113.21")
r5 = login(s5, "qa_auth_rate@example.com", "bad7")
rec("D_rotate_ip_same_email", describe_login(r5))

# Rotate IP + new email -> should be allowed (per-IP bypass for cross-account spray)
s6 = mk("203.0.113.22")
r6 = login(s6, "qa_auth_rate2@example.com", "bad8")
rec("D_rotate_ip_new_email", describe_login(r6))

# --- Test E: registration without token ---
sr_ = mk("203.0.113.30")
r7 = sr_.get(f"{BASE}/registro", timeout=10)
rec("E_registro_page", f"status={r7.status_code} len={len(r7.text)}")

print("\n===== SUMMARY =====")
for n, d in results:
    print(f"{n}: {d}")