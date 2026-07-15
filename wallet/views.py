# from rest_framework import status
# from rest_framework.authentication import TokenAuthentication
# from rest_framework.permissions import IsAuthenticated
# from rest_framework.response import Response
# from rest_framework.views import APIView

# from .models import Wallet
# from .serializers import WalletSerializer


# class WalletView(APIView):
#     """
#     GET /api/wallet/

#     Returns the authenticated user's wallet details.
#     No wallet ID or user ID is ever accepted from the client.
#     A 404 is returned if the wallet does not exist (signals failure).
#     """

#     authentication_classes = [TokenAuthentication]
#     permission_classes = [IsAuthenticated]

#     def get(self, request):
#         try:
#             wallet = Wallet.objects.get(owner=request.user)
#         except Wallet.DoesNotExist:
#             return Response(
#                 {"error": "Wallet not found."},
#                 status=status.HTTP_404_NOT_FOUND,
#             )

#         serializer = WalletSerializer(wallet)
#         return Response(serializer.data, status=status.HTTP_200_OK)

from rest_framework import status
from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Wallet
from .serializers import WalletSerializer


class WalletView(APIView):
    """
    GET /api/wallet/

    Returns the authenticated user's wallet details.
    No wallet ID or user ID is ever accepted from the client.
    A 404 is returned if the wallet does not exist (signals failure).
    """

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            wallet = Wallet.objects.get(owner=request.user)
        except Wallet.DoesNotExist:
            return Response(
                {"error": "Wallet not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = WalletSerializer(wallet)
        return Response(serializer.data, status=status.HTTP_200_OK)
