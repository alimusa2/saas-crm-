from sqlalchemy import Column, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase

class User(TenantAwareBase):
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    role_id = Column(String, ForeignKey("role.id"), nullable=True)

    # organization = relationship("Organization", back_populates="users")
    # role = relationship("Role", back_populates="users")

class Role(TenantAwareBase):
    name = Column(String, index=True, nullable=False)
    description = Column(String, nullable=True)

    # users = relationship("User", back_populates="role")
