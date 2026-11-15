"""Serve this folder over https so WebMIDI works on the tablet.

First run creates certs/ca.crt (install this on the tablet once) and a server
certificate signed by it. Usage: python serve_https.py [port] [extra host or IP ...]
"""
import datetime, http.server, ipaddress, os, socket, ssl, sys
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

HERE = os.path.dirname(os.path.abspath(__file__))
CERTS = os.path.join(HERE, "certs")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
EXTRA = sys.argv[2:]
NAMES = ["localhost", socket.gethostname().lower(), "127.0.0.1"] + EXTRA


def pem_key(k):
    return k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def name(cn):
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def make():
    os.makedirs(CERTS, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca = (x509.CertificateBuilder().subject_name(name("KRIECHSTROM board local CA")).issuer_name(name("KRIECHSTROM board local CA"))
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now).not_valid_after(now + datetime.timedelta(days=3650))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(digital_signature=True, key_cert_sign=True, crl_sign=True, content_commitment=False,
                                       key_encipherment=False, data_encipherment=False, key_agreement=False,
                                       encipher_only=False, decipher_only=False), critical=True)
          .sign(ca_key, hashes.SHA256()))
    key = ec.generate_private_key(ec.SECP256R1())
    sans = []
    for n in dict.fromkeys(NAMES):
        try:
            sans.append(x509.IPAddress(ipaddress.ip_address(n)))
        except ValueError:
            sans.append(x509.DNSName(n))
    leaf = (x509.CertificateBuilder().subject_name(name("KRIECHSTROM board")).issuer_name(ca.subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now).not_valid_after(now + datetime.timedelta(days=397))
            .add_extension(x509.SubjectAlternativeName(sans), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(ca_key, hashes.SHA256()))
    with open(os.path.join(CERTS, "ca.crt"), "wb") as f: f.write(ca.public_bytes(serialization.Encoding.PEM))
    with open(os.path.join(CERTS, "server.crt"), "wb") as f: f.write(leaf.public_bytes(serialization.Encoding.PEM) + ca.public_bytes(serialization.Encoding.PEM))
    with open(os.path.join(CERTS, "server.key"), "wb") as f: f.write(pem_key(key))
    with open(os.path.join(CERTS, "names.txt"), "w") as f: f.write("\n".join(dict.fromkeys(NAMES)))
    print("made certs/ca.crt and certs/server.crt for:", ", ".join(dict.fromkeys(NAMES)))


need = not all(os.path.exists(os.path.join(CERTS, f)) for f in ("ca.crt", "server.crt", "server.key", "names.txt"))
if not need:
    need = set(open(os.path.join(CERTS, "names.txt")).read().split()) != set(NAMES)
if need:
    make()

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(os.path.join(CERTS, "server.crt"), os.path.join(CERTS, "server.key"))
os.chdir(HERE)
class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):  # only the public CA certificate may leave certs/
        p = self.path.split("?")[0].lower()
        if p.startswith("/certs") and p != "/certs/ca.crt":
            self.send_error(404)
            return None
        return super().send_head()


srv = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
print(f"https://{socket.gethostname().lower()}:{PORT}/tablet/index.html  (on the tablet use this machine's address; pass it as an extra argument so the certificate covers it)")
srv.serve_forever()
