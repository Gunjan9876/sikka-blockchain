def user_role(request):
    """
    Provides 'is_university' to the template context.

    Since SIKKA is a JWT-based SPA, Django session auth is never used —
    request.user is always AnonymousUser. The actual is_university flag is
    injected directly by the view (org_dashboard_view passes is_university=True).

    This processor is a no-op fallback; individual views set the flag explicitly.
    """
    return {}
