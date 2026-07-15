from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class LoginRateThrottle(AnonRateThrottle):
    """5 login attempts per minute per IP — blocks brute-force."""
    scope = "login"


class MiningRateThrottle(UserRateThrottle):
    """10 mining actions per minute per user."""
    scope = "mining"