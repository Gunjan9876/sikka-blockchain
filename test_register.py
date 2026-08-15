import requests

url = "http://127.0.0.1:8000/api/v1/accounts/university-register/"
data = {
    "university_name": "Test University 3",
    "username": "testuniadmin3",
    "email": "admin3@testuni.edu",
    "contact_person": "John Doe",
    "contact_number": "1234567890",
    "website": "https://testuni.edu",
    "address": "123 Test St",
    "password": "Password123!",
    "confirm_password": "Password123!"
}

response = requests.post(url, json=data)
with open("error.html", "w") as f:
    f.write(response.text)
