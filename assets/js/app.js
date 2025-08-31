document.getElementById('go').addEventListener('click', () => {
  const hole = document.getElementById('hole').value;
  const bearing = document.getElementById('bearing').value;
  const driver = document.getElementById('driver').value;
  const iron = document.getElementById('iron').value;
  const when = document.getElementById('when').value;

  document.getElementById('wx').textContent = "Fetching weather soon...";
  document.getElementById('out').innerHTML = `
    <p>Hole ${hole}, Bearing ${bearing}°, Driver ${driver} yds, 7i ${iron} yds, Time: ${when}</p>
    <p>Next step: call weather API and compute tips.</p>
  `;
});
