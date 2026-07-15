from django.shortcuts import render


def dashboard_view(request):
    """
    Renders the dashboard shell.
    Client-side JavaScript checks for the auth token and handles all API calls.
    If no token is present the JS redirects to the login page immediately.
    """
    return render(request, "dashboard/dashboard.html")


def explorer_view(request):
    """
    Renders the Block Explorer shell.

    The `blockchain` app has no models/API yet (that's Phase 7), so this
    currently renders an empty-state UI. Once Block/Transaction models and
    a list endpoint exist, wire this page up to fetch from
    /api/blockchain/blocks/ the same way dashboard.js talks to the other
    APIs, instead of passing context from here.
    """
    return render(request, "blockchain/explorer.html")
