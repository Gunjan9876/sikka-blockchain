from rest_framework import status
from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .serializers import MiningSessionSerializer


class StartMiningView(APIView):
    """POST /api/mining/start/ — begin a new mining session."""

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            session = services.start_mining(request.user)
            serializer = MiningSessionSerializer(session)
            return Response(
                {"message": "Mining started successfully.", "data": serializer.data},
                status=status.HTTP_201_CREATED,
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class ClaimMiningView(APIView):
    """POST /api/mining/claim/ — claim reward for the active session."""

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            session = services.claim_mining(request.user)
            serializer = MiningSessionSerializer(session)
            return Response(
                {
                    "message": "Mining reward claimed successfully.",
                    "reward": str(session.reward),
                    "data": serializer.data,
                },
                status=status.HTTP_200_OK,
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class MiningStatusView(APIView):
    """GET /api/mining/status/ — current mining status and estimated reward."""

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = services.get_status(request.user)
        return Response(data, status=status.HTTP_200_OK)