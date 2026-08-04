import os
import uuid
import shutil
from fastapi import UploadFile
from app.core.config import settings

class StorageManager:
    @staticmethod
    async def upload_file(file: UploadFile) -> str:
        """
        Uploads a file based on configured STORAGE_TYPE settings.
        Returns the public URL of the uploaded asset.
        """
        file_ext = os.path.splitext(file.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_ext}"

        if settings.STORAGE_TYPE == "s3":
            try:
                import boto3
                s3_client = boto3.client(
                    "s3",
                    aws_access_key_id=settings.S3_ACCESS_KEY,
                    aws_secret_access_key=settings.S3_SECRET_KEY,
                    region_name=settings.S3_REGION or None
                )
                file.file.seek(0)
                s3_client.upload_fileobj(
                    file.file,
                    settings.S3_BUCKET,
                    unique_filename,
                    ExtraArgs={"ContentType": file.content_type}
                )
                region_str = f"-{settings.S3_REGION}" if settings.S3_REGION else ""
                return f"https://{settings.S3_BUCKET}.s3{region_str}.amazonaws.com/{unique_filename}"
            except Exception as e:
                print(f"S3 Upload failed: {str(e)}. Falling back to local storage.")

        if settings.STORAGE_TYPE == "cloudinary" or settings.CLOUDINARY_URL or settings.CLOUDINARY_CLOUD_NAME:
            try:
                import cloudinary
                import cloudinary.uploader

                cloud_name = settings.CLOUDINARY_CLOUD_NAME
                api_key = settings.CLOUDINARY_API_KEY
                api_secret = settings.CLOUDINARY_API_SECRET

                url_str = settings.CLOUDINARY_URL
                if url_str and url_str.startswith("cloudinary://"):
                    creds, cname = url_str.replace("cloudinary://", "").split("@")
                    k, s = creds.split(":")
                    cloud_name = cloud_name or cname
                    api_key = api_key or k
                    api_secret = api_secret or s

                if cloud_name and api_key and api_secret:
                    cloudinary.config(
                        cloud_name=cloud_name,
                        api_key=api_key,
                        api_secret=api_secret,
                        secure=True
                    )
                    file.file.seek(0)
                    upload_result = cloudinary.uploader.upload(
                        file.file,
                        public_id=os.path.splitext(unique_filename)[0],
                        resource_type="auto"
                    )
                    if upload_result and upload_result.get("secure_url"):
                        return upload_result.get("secure_url")
            except Exception as e:
                print(f"Cloudinary Upload failed: {str(e)}. Falling back to local storage.")

        # Local storage (Default fallback)
        upload_dir = "static/uploads"
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, unique_filename)
        
        file.file.seek(0)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        return f"/static/uploads/{unique_filename}"

    @staticmethod
    async def upload_bytes(content: bytes, filename: str, content_type: str = "application/octet-stream") -> str:
        """
        Uploads raw binary bytes to Cloudinary or configured storage.
        Returns the public URL of the uploaded file.
        """
        import io
        file_ext = os.path.splitext(filename)[1] or ""
        unique_filename = f"{uuid.uuid4()}{file_ext}"

        if settings.STORAGE_TYPE == "s3":
            try:
                import boto3
                s3_client = boto3.client(
                    "s3",
                    aws_access_key_id=settings.S3_ACCESS_KEY,
                    aws_secret_access_key=settings.S3_SECRET_KEY,
                    region_name=settings.S3_REGION or None
                )
                s3_client.upload_fileobj(
                    io.BytesIO(content),
                    settings.S3_BUCKET,
                    unique_filename,
                    ExtraArgs={"ContentType": content_type}
                )
                region_str = f"-{settings.S3_REGION}" if settings.S3_REGION else ""
                return f"https://{settings.S3_BUCKET}.s3{region_str}.amazonaws.com/{unique_filename}"
            except Exception as e:
                print(f"S3 Upload bytes failed: {str(e)}. Falling back to local storage.")

        if settings.STORAGE_TYPE == "cloudinary" or settings.CLOUDINARY_URL or settings.CLOUDINARY_CLOUD_NAME:
            try:
                import cloudinary
                import cloudinary.uploader

                cloud_name = settings.CLOUDINARY_CLOUD_NAME
                api_key = settings.CLOUDINARY_API_KEY
                api_secret = settings.CLOUDINARY_API_SECRET

                url_str = settings.CLOUDINARY_URL
                if url_str and url_str.startswith("cloudinary://"):
                    creds, cname = url_str.replace("cloudinary://", "").split("@")
                    k, s = creds.split(":")
                    cloud_name = cloud_name or cname
                    api_key = api_key or k
                    api_secret = api_secret or s

                if cloud_name and api_key and api_secret:
                    cloudinary.config(
                        cloud_name=cloud_name,
                        api_key=api_key,
                        api_secret=api_secret,
                        secure=True
                    )
                    upload_result = cloudinary.uploader.upload(
                        io.BytesIO(content),
                        public_id=os.path.splitext(unique_filename)[0],
                        resource_type="auto"
                    )
                    if upload_result and upload_result.get("secure_url"):
                        return upload_result.get("secure_url")
            except Exception as e:
                print(f"Cloudinary Upload bytes failed: {str(e)}. Falling back to local storage.")

        # Local storage fallback
        upload_dir = "static/uploads"
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, unique_filename)
        with open(file_path, "wb") as f:
            f.write(content)

        return f"/static/uploads/{unique_filename}"

