from alembic import context
from sqlalchemy import create_engine

from backend.config import Settings
from backend.models import Base

config = context.config
connection = config.attributes.get("connection")

if connection is not None:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()
elif context.is_offline_mode():
    settings = Settings()
    context.configure(url=settings.database_url, target_metadata=Base.metadata,
                      literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()
else:
    settings = Settings()
    engine = create_engine(settings.database_url, hide_parameters=True)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
