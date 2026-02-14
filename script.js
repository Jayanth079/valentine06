const cards = document.querySelectorAll(".card");
let index = 0;

function startStory() {
  const music = document.getElementById("bgMusic");
  music.play().catch(() => {});
  next();
}

function next() {
  cards[index].classList.remove("active");
  index++;
  if (index < cards.length) {
    cards[index].classList.add("active");
  }
}

/* No button runs away */
document.addEventListener("mouseover", function (e) {
  if (e.target.classList.contains("no")) {
    e.target.style.transform =
      `translate(${Math.random() * 120 - 60}px, ${Math.random() * 120 - 60}px)`;
  }
});

/* SLIDESHOW LOGIC */
let currentImage = 1;
const totalImages = 5; // 🔴 CHANGE THIS NUMBER if needed
const slideshow = document.getElementById("slideshow");

if (slideshow) {
  setInterval(() => {
    currentImage++;
    if (currentImage > totalImages) {
      currentImage = 1;
    }
    slideshow.src = `images/${currentImage}.jpg`;
  }, 3000); // changes every 3 seconds
}
