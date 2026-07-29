from sqlalchemy import Column, String
from sqlalchemy.orm import relationship
from app.db.base_class import Base

class Organization(Base):
    name = Column(String, index=True, nullable=False)
    domain = Column(String, unique=True, index=True, nullable=True)
    settings_json = Column(String, nullable=True)

    # We will add relationships as we build other modules
    # users = relationship("User", back_populates="organization")
