# Organizations

Owns organization membership and the employer overview read model.

The employer overview application query authorizes an employer actor, derives
the organization from that actor, and reads tenant-scoped employee, lending,
and loan summaries through a repository interface. It does not expose commands
or mutate lending data.
