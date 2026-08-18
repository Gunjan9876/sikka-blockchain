from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from .models import User


class RegisterSerializer(serializers.ModelSerializer):
    email            = serializers.EmailField(required=True)
    password         = serializers.CharField(write_only=True)
    confirm_password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "phone",
            "password",
            "confirm_password",
        ]

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate_password(self, value):
        # Length
        if len(value) < 8:
            raise serializers.ValidationError("Password must be at least 8 characters.")
        # Uppercase
        if not any(c.isupper() for c in value):
            raise serializers.ValidationError("Password must contain at least one uppercase letter.")
        # Digit
        if not any(c.isdigit() for c in value):
            raise serializers.ValidationError("Password must contain at least one number.")
        # Special char
        if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in value):
            raise serializers.ValidationError("Password must contain at least one special character.")
        # Django's built-in validators (CommonPasswordValidator etc.)
        try:
            validate_password(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(list(e.messages))
        return value

    def validate(self, data):
        if data["password"] != data["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return data

    def create(self, validated_data):
        validated_data.pop("confirm_password")
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.email_verified = True 
        user.is_active = True   # active but email_verified=False
        user.save()
        return user


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    token    = serializers.UUIDField()
    password = serializers.CharField(write_only=True)
    confirm_password = serializers.CharField(write_only=True)

    def validate_password(self, value):
        if len(value) < 8:
            raise serializers.ValidationError("Password must be at least 8 characters.")
        if not any(c.isupper() for c in value):
            raise serializers.ValidationError("Must contain at least one uppercase letter.")
        if not any(c.isdigit() for c in value):
            raise serializers.ValidationError("Must contain at least one number.")
        if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in value):
            raise serializers.ValidationError("Must contain at least one special character.")
        try:
            validate_password(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(list(e.messages))
        return value

    def validate(self, data):
        if data["password"] != data["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return data


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)
    confirm_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        if len(value) < 8:
            raise serializers.ValidationError("Password must be at least 8 characters.")
        if not any(c.isupper() for c in value):
            raise serializers.ValidationError("Must contain at least one uppercase letter.")
        if not any(c.isdigit() for c in value):
            raise serializers.ValidationError("Must contain at least one number.")
        if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in value):
            raise serializers.ValidationError("Must contain at least one special character.")
        try:
            validate_password(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(list(e.messages))
        return value

    def validate(self, data):
        if data["new_password"] != data["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return data


class UniversityRegisterSerializer(RegisterSerializer):
    university_name = serializers.CharField(max_length=128, required=True, write_only=True)
    contact_person  = serializers.CharField(max_length=128, required=True, write_only=True)
    contact_number  = serializers.CharField(max_length=20, required=True, write_only=True)
    website         = serializers.URLField(required=False, allow_blank=True, write_only=True)
    address         = serializers.CharField(required=True, write_only=True)
    logo            = serializers.ImageField(required=False, allow_null=True, write_only=True)

    class Meta(RegisterSerializer.Meta):
        fields = RegisterSerializer.Meta.fields + [
            "university_name", "contact_person", "contact_number", "website", "address", "logo"
        ]

    def create(self, validated_data):
        from wallet.models import Organisation
        from django.utils.text import slugify
        
        university_name = validated_data.pop("university_name")
        contact_person  = validated_data.pop("contact_person")
        contact_number  = validated_data.pop("contact_number")
        website         = validated_data.pop("website", "")
        address         = validated_data.pop("address")
        logo            = validated_data.pop("logo", None)

        # Create user (from parent create which hashes password etc.)
        user = super().create(validated_data)

        # Wallet is created by a background thread via signal — wait for it,
        # or create synchronously if the thread hasn't finished yet.
        from wallet.models import Wallet
        from wallet.services import create_wallet
        import time
        for _ in range(10):
            try:
                wallet = Wallet.objects.get(owner=user)
                break
            except Wallet.DoesNotExist:
                time.sleep(0.3)
        else:
            # Thread never finished — create synchronously
            wallet = create_wallet(owner=user)
        
        # Create organisation
        base_slug = slugify(university_name)
        slug = base_slug
        counter = 1
        while Organisation.objects.filter(slug=slug).exists():
            slug = f"{base_slug}-{counter}"
            counter += 1
            
        Organisation.objects.create(
            name=university_name,
            wallet=wallet,
            slug=slug,
            verification_status=Organisation.VerificationStatus.PENDING,
            contact_person=contact_person,
            contact_number=contact_number,
            website=website,
            address=address,
            logo=logo
        )
        return user
