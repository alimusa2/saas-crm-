import requests

r = requests.post("http://127.0.0.1:8000/api/v1/auth/login", data={"username": "demo@growthos.com", "password": "Pass123!"})
print("STATUS:", r.status_code)
if r.status_code == 200:
    token = r.json().get("access_token")
    print("TOKEN:", token)
    with open("token.txt", "w") as f:
        f.write(token)
else:
    print("ERROR:", r.text)
