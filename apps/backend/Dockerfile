FROM grafana/grafana:13.3.1
COPY infra/dashboards /etc/grafana/dawn-dashboards
COPY infra/dashboards.yaml /etc/grafana/provisioning/dashboards/dawn.yaml
COPY infra/influxdb.yaml /etc/grafana/provisioning/datasources/dawn.yaml
USER root
RUN sed -i 's|http://influxdb:8086|http://influxdb.railway.internal:8086|' /etc/grafana/provisioning/datasources/dawn.yaml
# Railway mounts the persistent volume as root. Grafana itself runs as its image user.
ENTRYPOINT ["/bin/sh", "-ec", "chown grafana:root /var/lib/grafana; exec su -s /bin/sh grafana -c 'exec /run.sh'"]
