from django.shortcuts import render


def dashboard_view(request):
    """
    Renders the dashboard shell.
    Client-side JavaScript checks for the auth token and handles all API calls.
    If no token is present the JS redirects to the login page immediately.
    """
    return render(request, "dashboard/dashboard.html")
