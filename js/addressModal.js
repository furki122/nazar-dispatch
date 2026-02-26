import { state } from "./state.js";
import { saveCustomers } from "./customers.js";

let currentCustomer = null;

export function initAddressModal(){
  const input = document.getElementById("modalAddressInput");

  const autocomplete = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: "at" },
    fields: ["formatted_address", "geometry"]
  });

  document.getElementById("modalCancel").onclick = () => {
    closeModal();
  };

  document.getElementById("modalSave").onclick = () => {
    if (!currentCustomer) return;

    const newAddress = input.value;
    currentCustomer.adresse = newAddress;

    saveCustomers(); // dauerhaft speichern

    closeModal();
  };
}

export function openAddressModal(customer, originalText){
  currentCustomer = customer;

  document.getElementById("modalOriginal").innerText =
    "Nicht gefunden: " + originalText;

  document.getElementById("modalAddressInput").value = "";
  document.getElementById("addressModal").classList.remove("hidden");
}

function closeModal(){
  document.getElementById("addressModal").classList.add("hidden");
  currentCustomer = null;
}