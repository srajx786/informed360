const theme = localStorage.getItem("theme") || "light";
document.body.classList.toggle("theme-dark", theme === "dark");
const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();
