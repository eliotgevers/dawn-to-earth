# Dawn to Earth

I’m Eliot Gevers. I built Dawn to Earth in 4 days to show how I’d build and connect engineering tools and dashboards at Dawn Aerospace. It’s an independent portfolio demo. Public sources establish the mission and flight history. The engineering records, inspections and decisions are fictional.

[Live demo](https://dawn2.earth/) · [Personal website](https://www.eliotgevers.com/) · [CV](https://dawn2.earth/cv)

## Features

- **Record tracking** follows a requirement through engineering, production and verification for the same unit and revision.
- **Readiness** shows what holds a unit, who owns the next step and which evidence supports sign-off.
- **Ask** finds Home assignments and source records, and drafts shared evidence notes for confirmation.
- **Wiki** explains concepts such as qualification and acceptance alongside the records that use them.
- **Aurora** pairs documented flight history with campaign reports and a calendar of historical flights and demo appointments.
- **Bench imports** connect a fictional recording to its unit, revision and exact time range in Grafana.
- **Design comparisons** show what changed between interface revisions and link to the supporting evidence.
- **Production planning** compares station conflicts and delivery dates across schedules.
- **Lot trace** connects a material lot to the build that used it.

## Stack

- **InfluxDB and Grafana** store and visualize recorded readings.
- **Next.js, React and TypeScript** power the web app.
- **PostgreSQL and Drizzle ORM** store records, relationships and review history.
- **Tailwind CSS and shadcn/ui** style the workspace.
- **Three.js and satellite.js** render the Fleet globe and estimated positions.
- **Bun, Python and Docker Compose** run the app, archive imports and local services.

## Local setup

With Docker Compose, Python 3 and OpenSSL installed, run these from the repository root. Run the first command once for a new instance.

```sh
python3 apps/backend/scripts/stack.py init ~/.local/share/dawn-demo
python3 apps/backend/scripts/stack.py up dev ~/.local/share/dawn-demo
```

Open at [http://localhost:4331](http://localhost:4331).
