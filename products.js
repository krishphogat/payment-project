const PRODUCTS = [
  {
    id: "workshop-pass",
    name: "Workshop Pass",
    description: "Full-day access to the payment gateway workshop.",
    price: 49900
  },
  {
    id: "pass-and-kit",
    name: "Pass + Starter Kit",
    description: "Workshop seat plus a printed workbook and swag kit.",
    price: 89900
  },
  {
    id: "team-pass",
    name: "Team Pass",
    description: "Five seats for your team, billed once.",
    price: 199900
  }
];

function findProduct(id) {
  return PRODUCTS.find((product) => product.id === id);
}

module.exports = { PRODUCTS, findProduct };
