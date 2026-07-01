from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .services import MiningService
from .serializers import MiningSessionSerializer


class StartMiningView(APIView):

    def post(self, request):
        try:
            session = MiningService.start_mining(request.user)

            serializer = MiningSessionSerializer(session)

            return Response(
                {
                    "message": "Mining started successfully.",
                    "data": serializer.data
                },
                status=status.HTTP_201_CREATED
            )

        except ValueError as e:
            return Response(
                {
                    "error": str(e)
                },
                status=status.HTTP_400_BAD_REQUEST
            )