import { auth, db } from './firebase-config.js';

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  query,
  where,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';


/* =========================================================
   SERVICES
========================================================= */

const services = [
  ['🔧', 'Mechanic', 'Car & bike repairs'],
  ['🚛', 'Towing', 'Vehicle towing'],
  ['🔋', 'Battery', 'Jump start & battery'],
  ['🛞', 'Tyre Repair', 'Puncture & tyre help'],
  ['⚡', 'Electrician', 'Electrical services'],
  ['🚰', 'Plumber', 'Plumbing repairs'],
  ['❄️', 'AC Repair', 'AC service & repair'],
  ['🔑', 'Locksmith', 'Lock & key services'],
  ['💻', 'IT Support', 'Computer & network help'],
  ['📱', 'Mobile Repair', 'Phone repairs'],
  ['🧹', 'Cleaning', 'Home & office cleaning'],
  ['🪚', 'Carpenter', 'Furniture & woodwork']
];


/* =========================================================
   GLOBAL VARIABLES
========================================================= */

const $ = id => document.getElementById(id);

const serviceGrid = $('serviceGrid');
const workerList = $('workerList');
const searchInput = $('serviceSearch');
const locationStatus = $('locationStatus');

// All services offered by a provider. Older records with only `service` still work.
function workerServices(worker) {
  const values = Array.isArray(worker.services) && worker.services.length
    ? worker.services : [worker.service];
  return [...new Set(values.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))];
}

function getSelectedProviderServices() {
  return Array.from(document.querySelectorAll('#serviceMultiSelect input[name="providerServices"]:checked'))
    .map(input => input.value);
}

function updateSelectedServiceCount() {
  const count = getSelectedProviderServices().length;
  const target = $('selectedServiceCount');
  if (target) target.textContent = `${count} service${count === 1 ? '' : 's'} selected`;
}
$('serviceMultiSelect')?.addEventListener('change', updateSelectedServiceCount);


let workers = [];
let userLocation = null;
let selectedWorker = null;

let userMarker = null;
let markers = [];

let providerPickerMap = null;
let providerPickerMarker = null;
let providerLocation = null;


/* =========================================================
   SERVICE CARDS
========================================================= */

services.forEach(([icon, name, desc]) => {

  const card = document.createElement('div');

  card.className = 'service-card';

  card.innerHTML = `
    <div class="icon">${icon}</div>
    <h3>${name}</h3>
    <p>${desc}</p>
  `;

  card.onclick = () => selectService(name);

  serviceGrid.appendChild(card);
});


/* =========================================================
   MAIN NEARBY MAP
========================================================= */

const map = L.map('map', {
  zoomControl: true,
  scrollWheelZoom: false
}).setView([7.8731, 80.7718], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Div icons have predictable colored pins, independent of browser icon assets.
const providerPinIcon = L.divIcon({
  className: 'onawadak-pin-container',
  html: '<span class="onawadak-map-pin provider-pin"><span></span></span>',
  iconSize: [32, 42], iconAnchor: [16, 39], popupAnchor: [0, -37]
});
const customerPinIcon = L.divIcon({
  className: 'onawadak-pin-container',
  html: '<span class="onawadak-map-pin customer-pin"><span></span></span>',
  iconSize: [32, 42], iconAnchor: [16, 39], popupAnchor: [0, -37]
});
let customerRadiusCircle = null;

// Leaflet needs a resize notification whenever the responsive map box changes.
if (typeof ResizeObserver !== 'undefined') {
  const mapResizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  });
  mapResizeObserver.observe(document.getElementById('map'));
}


/* =========================================================
   MAP SIZE FIX
========================================================= */

function fixNearbyMapSize() {

  if (!map) return;

  setTimeout(() => {
    map.invalidateSize(true);
  }, 300);
}


/* =========================================================
   HTML SECURITY
========================================================= */

function escapeHtml(value) {

  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


/* =========================================================
   DISTANCE CALCULATION
========================================================= */

function haversineKm(a, b) {

  const R = 6371;

  const rad = degree =>
    degree * Math.PI / 180;

  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);

  const x =
    Math.sin(dLat / 2) ** 2 +

    Math.cos(rad(a.lat)) *
    Math.cos(rad(b.lat)) *

    Math.sin(dLng / 2) ** 2;

  return 2 * R *
    Math.asin(Math.sqrt(x));
}


/* =========================================================
   LOAD WORKERS FROM FIRESTORE
========================================================= */

async function loadWorkers() {

  workerList.innerHTML = `
    <div class="worker-empty">
      Loading registered providers...
    </div>
  `;

  try {

    const q = query(
      collection(db, 'users'),
      where('role', '==', 'worker')
    );

    const snap = await getDocs(q);

    workers = snap.docs

      .map(document => ({
        id: document.id,
        ...document.data()
      }))

      .filter(worker =>

        Number.isFinite(
          Number(worker.lat)
        ) &&

        Number.isFinite(
          Number(worker.lng)
        )

      );


    renderWorkers(
      searchInput.value.trim()
    );

  } catch (error) {

    console.error(
      'Worker loading error:',
      error
    );

    workerList.innerHTML = `
      <div class="worker-empty">

        Could not load providers.

        <br>

        Check Firestore rules and
        internet connection.

      </div>
    `;
  }
}


/* =========================================================
   RENDER + FILTER WORKERS
========================================================= */

function renderWorkers(filter = '') {

  workerList.innerHTML = '';


  /* Remove old worker markers */

  markers.forEach(marker => {

    map.removeLayer(marker);

  });

  markers = [];


  const radius =
    Number(
      $('radiusSelect').value || 10
    );


  const needle =
    filter
      .toLowerCase()
      .trim();


  /* =====================================================
     FILTER
  ===================================================== */

  let list = workers

    .filter(worker => {

      const workerServiceText = workerServices(worker).join(' ').toLowerCase();


      const name =
        String(
          worker.name || ''
        ).toLowerCase();


      const matches =

        !needle ||

        workerServiceText.includes(needle) ||

        name.includes(needle);


      if (!matches) {
        return false;
      }


      /* Don't show unavailable workers */

      if (worker.available === false) {
        return false;
      }


      /*
       If customer location has not
       been selected, show workers.
      */

      if (!userLocation) {
        return true;
      }


      const distance =
        haversineKm(

          userLocation,

          {
            lat: Number(worker.lat),
            lng: Number(worker.lng)
          }

        );


      return distance <= radius;
    })


    /* Calculate distance */

    .map(worker => {

      let distance = null;


      if (userLocation) {

        distance = haversineKm(

          userLocation,

          {
            lat: Number(worker.lat),
            lng: Number(worker.lng)
          }

        );
      }


      return {
        ...worker,
        distance
      };
    })


    /* Nearest provider first */

    .sort((a, b) => {

      const distanceA =
        a.distance ?? 99999;

      const distanceB =
        b.distance ?? 99999;

      return distanceA - distanceB;
    });


  /* =====================================================
     NO PROVIDERS
  ===================================================== */

  if (!list.length) {

    workerList.innerHTML = `
      <div class="worker-empty">

        <strong>
          No providers found.
        </strong>

        <br>

        ${
          userLocation

            ? `No matching available providers within ${radius} km.`

            : 'Try another service or allow your location.'
        }

      </div>
    `;


    const counter = $('mapProviderCount');
    if (counter) counter.textContent = '0 matching providers on the map';
    fixNearbyMapSize();

    return;
  }


  /* =====================================================
     SHOW PROVIDERS
  ===================================================== */

  list.forEach(worker => {

    const el =
      document.createElement('div');

    el.className = 'worker';


    /* Distance / location */

    let distanceHtml = '';


    if (worker.distance !== null) {

      distanceHtml = `
        <span class="distance-badge">

          📍
          ${worker.distance.toFixed(1)}
          km away

        </span>
      `;

    } else if (worker.location) {

      distanceHtml = `
        <span class="distance-badge">

          📍
          ${escapeHtml(worker.location)}

        </span>
      `;
    }


    /* Worker Card */

    el.innerHTML = `

      <div class="worker-top">

        <div>

          <h3>
            ${escapeHtml(
              worker.name ||
              'Service Provider'
            )}
          </h3>


          <small>

            ${escapeHtml(workerServices(worker).join(' • ') || 'Service')}

            •

            ${escapeHtml(
              worker.experience ||
              'Experience not specified'
            )}

          </small>


          <br>

          ${distanceHtml}

        </div>


        <div class="rating">

          ⭐ ${Number(worker.reviewCount || 0) > 0 ? `${Number(worker.rating || 0).toFixed(1)} (${Number(worker.reviewCount)})` : 'New'}

        </div>

      </div>


      <div class="available">

        ● Available now

      </div>


      ${
        worker.description

          ? `
            <div class="worker-description">

              ${escapeHtml(
                worker.description
              )}

            </div>
          `

          : ''
      }


      <div class="worker-actions">

        <button
          data-call="${escapeHtml(
            worker.phone || ''
          )}"
        >

          📞 Call

        </button>


        <button
          class="request"
          data-request="${worker.id}"
        >

          Request

        </button>

      </div>
    `;


    workerList.appendChild(el);


    /* =================================================
       MAP MARKER
    ================================================= */

    const latitude =
      Number(worker.lat);

    const longitude =
      Number(worker.lng);


    const marker = L.marker([

      latitude,
      longitude

    ], { icon: providerPinIcon, title: worker.name || 'Service Provider' })

      .addTo(map)

      .bindPopup(`

        <b>
          ${escapeHtml(
            worker.name ||
            'Provider'
          )}
        </b>

        <br>

        ${escapeHtml(workerServices(worker).join(', '))}

        ${
          worker.distance !== null

            ? `
              <br>
              ${worker.distance.toFixed(1)}
              km away
            `

            : ''
        }

      `);


    markers.push(marker);

  });


  const counter = $('mapProviderCount');
  if (counter) counter.textContent = `${list.length} matching provider${list.length === 1 ? '' : 's'} on the map`;

  /* Fix Leaflet display */
  fixNearbyMapSize();
}


/* =========================================================
   WORKER BUTTONS
========================================================= */

workerList.addEventListener(
  'click',
  event => {

    /* CALL */

    const call =
      event.target.closest(
        '[data-call]'
      );


    if (call) {

      const phone =
        call.dataset.call.replace(
          /[^\d+]/g,
          ''
        );


      if (!phone) {

        alert(
          'This provider has not added a phone number.'
        );

        return;
      }


      window.location.href =
        `tel:${phone}`;

      return;
    }


    /* REQUEST */

    const request =
      event.target.closest(
        '[data-request]'
      );


    if (request) {

      openRequest(
        request.dataset.request
      );
    }
  }
);


/* =========================================================
   SELECT SERVICE
========================================================= */

function selectService(service) {

  searchInput.value = service;

  renderWorkers(service);

  $('nearby').scrollIntoView({
    behavior: 'smooth'
  });
}


window.selectService =
  selectService;


/* Emergency Help buttons */

document
  .querySelectorAll('[data-service]')
  .forEach(button => {

    button.addEventListener(
      'click',
      () => {

        selectService(
          button.dataset.service
        );

      }
    );

  });


/* =========================================================
   FIND HELP
========================================================= */

$('findHelpBtn')
  .addEventListener(
    'click',
    () => {

      renderWorkers(
        searchInput.value.trim()
      );

      $('nearby')
        .scrollIntoView({
          behavior: 'smooth'
        });
    }
  );


searchInput
  .addEventListener(
    'keydown',
    event => {

      if (event.key === 'Enter') {

        $('findHelpBtn').click();

      }
    }
  );


/* Radius change */

$('radiusSelect')
  .addEventListener(
    'change',
    () => {

      renderWorkers(
        searchInput.value.trim()
      );

    }
  );


/* =========================================================
   CUSTOMER CURRENT LOCATION
========================================================= */

function useCustomerLocation() {

  if (!navigator.geolocation) {

    locationStatus.textContent =
      'Geolocation is not supported by this browser.';

    return;
  }


  locationStatus.textContent =
    'Getting your location...';


  navigator.geolocation
    .getCurrentPosition(

      position => {

        userLocation = {

          lat:
            position.coords.latitude,

          lng:
            position.coords.longitude

        };


        /* Remove previous customer marker */

        if (userMarker) {

          map.removeLayer(
            userMarker
          );
        }


        /* Add customer marker */

        userMarker = L.marker([

          userLocation.lat,

          userLocation.lng

        ], { icon: customerPinIcon, title: 'Your current location', zIndexOffset: 1000 })

          .addTo(map)

          .bindPopup(
            '<b>📍 Your Location</b>'
          )

          .openPopup();


        /* Show the customer's chosen search radius as a subtle circle. */
        if (customerRadiusCircle) map.removeLayer(customerRadiusCircle);
        const radiusKm = Number($('radiusSelect').value || 10);
        customerRadiusCircle = L.circle([userLocation.lat, userLocation.lng], {
          radius: radiusKm * 1000,
          color: '#2563eb',
          weight: 1.5,
          opacity: 0.5,
          fillColor: '#60a5fa',
          fillOpacity: 0.06,
          interactive: false
        }).addTo(map);

        locationStatus.textContent =
          'Location ready. Red pins show matching providers within your search radius.';

        renderWorkers(searchInput.value.trim());

        // Center on the user, while keeping nearby provider pins in view.
        const visiblePoints = [userMarker.getLatLng(), ...markers.map(marker => marker.getLatLng())];
        requestAnimationFrame(() => {
          map.invalidateSize({ pan: false });
          if (visiblePoints.length > 1) {
            map.fitBounds(L.latLngBounds(visiblePoints), {
              padding: [42, 42], maxZoom: 14, animate: true
            });
          } else {
            map.setView([userLocation.lat, userLocation.lng], 13);
          }
        });

      },


      error => {

        console.error(
          'Location error:',
          error
        );


        locationStatus.textContent =
          'Could not access your location. Please allow location permission.';

      },


      {

        enableHighAccuracy: true,

        timeout: 10000,

        maximumAge: 60000

      }
    );
}


$('locationBtn')
  .addEventListener(
    'click',
    useCustomerLocation
  );

$('radiusSelect')?.addEventListener('change', () => {
  if (!userLocation || !customerRadiusCircle) return;
  customerRadiusCircle.setRadius(Number($('radiusSelect').value || 10) * 1000);
});


/* =========================================================
   REQUEST MODAL
========================================================= */

const requestModal =
  $('requestModal');


function openRequest(id) {
  selectedWorker = workers.find(worker => worker.id === id);
  if (!selectedWorker) return;

  if (auth.currentUser?.uid === selectedWorker.id) {
    alert('You cannot request your own service.');
    return;
  }

  const offeredServices = workerServices(selectedWorker);
  const picker = $('requestServicePicker');
  const select = $('requestServiceSelect');
  select.replaceChildren();

  offeredServices.forEach(service => {
    const option = document.createElement('option');
    option.value = service;
    option.textContent = service;
    select.appendChild(option);
  });

  // If the customer searched for a specific service, preselect it.
  const searchedService = searchInput.value.trim().toLowerCase();
  const matchingService = offeredServices.find(service => service.toLowerCase() === searchedService);
  if (matchingService) select.value = matchingService;
  picker.hidden = offeredServices.length <= 1;

  $('requestWorkerName').textContent = selectedWorker.name || 'Service Provider';
  $('requestServiceName').textContent = offeredServices.length > 1
    ? `${offeredServices.length} available services — choose the one you need`
    : (offeredServices[0] || 'Service');
  requestModal.classList.remove('hidden');
}

$('closeRequest').onclick =
  () => {

    requestModal
      .classList.add('hidden');

  };


/* =========================================================
   SEND SERVICE REQUEST
========================================================= */

$('requestForm').onsubmit =
  async event => {

    event.preventDefault();


    const user = auth.currentUser;
    const requestedService = $('requestServiceSelect').value;
    if (!selectedWorker || !workerServices(selectedWorker).includes(requestedService)) {
      alert('Please select a valid service.');
      return;
    }


    if (!user) {

      alert(
        'Please login to send a service request.'
      );

      requestModal
        .classList.add('hidden');

      openAuthModal();

      return;
    }


    const userSnap =
      await getDoc(
        doc(
          db,
          'users',
          user.uid
        )
      );


    const profile =
      userSnap.exists()

        ? userSnap.data()

        : {};


      // Allow both customers and service providers
const requesterRole = profile.role || 'user';

if (!['user', 'worker'].includes(requesterRole)) {
  alert('Your account type cannot send service requests.');
  return;
}

// Prevent sending a request to your own profile
if (selectedWorker.id === user.uid) {
  alert('You cannot send a service request to your own profile.');
  return;
}

    // Ensure service provider receives location coordinates or address
    const hasProfileLocation = Boolean(profile.location && profile.location.trim());
    if (!userLocation && !hasProfileLocation) {
      const allowLocation = confirm(
        'Location Required:\n\n' +
        'To ensure the service provider can locate and reach you, please share your location.\n\n' +
        'Click "OK" to allow access to your current GPS location, or "Cancel" to specify your city/area manually.'
      );

      if (allowLocation) {
        try {
          const position = await new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
              reject(new Error('Geolocation is not supported by your browser.'));
              return;
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 60000
            });
          });

          userLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };

          if (typeof map !== 'undefined' && map) {
            if (typeof userMarker !== 'undefined' && userMarker) {
              map.removeLayer(userMarker);
            }
            userMarker = L.marker([userLocation.lat, userLocation.lng])
              .addTo(map)
              .bindPopup('<b>📍 Your Location</b>')
              .openPopup();
            map.setView([userLocation.lat, userLocation.lng], 13);
          }

          if (typeof locationStatus !== 'undefined' && locationStatus) {
            locationStatus.textContent =
              'Location ready. Showing nearest registered providers.';
          }

          if (typeof renderWorkers === 'function' && typeof searchInput !== 'undefined') {
            renderWorkers(searchInput.value.trim());
          }
        } catch (geoError) {
          console.warn('Geolocation access failed or denied:', geoError);
          alert('Could not access device location. Please specify your city or address manually.');
        }
      }

      if (!userLocation) {
        const manualLocation = prompt(
          'Please enter your city, area, or address so the service provider knows your location:'
        );

        if (!manualLocation || !manualLocation.trim()) {
          alert('Location required: You must allow location access or specify your city/location before submitting a service request.');
          return;
        }

        profile.location = manualLocation.trim();

        try {
          await updateDoc(doc(db, 'users', user.uid), {
            location: profile.location
          });
        } catch (profileUpdateErr) {
          console.warn('Could not update profile location:', profileUpdateErr);
        }
      }
    }


    try {

      await addDoc(

        collection(
          db,
          'requests'
        ),

        {

          providerId:
            selectedWorker.id,


          providerSnapshot: {

            name:
              selectedWorker.name || '',

            phone:
              selectedWorker.phone || '',

            service:
              requestedService

          },


<<<<<<< HEAD
          customerId: user.uid,
=======
          customerId:
            user.uid,
>>>>>>> main

customerRole: requesterRole,

customerSnapshot: {

  name:
    profile.name ||
    user.email ||
    'Customer',

  phone:
    profile.phone || '',

  email:
    profile.email ||
    user.email ||
    '',

  location:
    profile.location ||
    (userLocation
      ? `${userLocation.lat.toFixed(6)}, ${userLocation.lng.toFixed(6)}`
      : ''),

  role: requesterRole

},


          serviceType:
            requestedService,


          description:
            $('problemInput')
              .value
              .trim(),


          location:
            userLocation

              ? `${userLocation.lat.toFixed(6)}, ${userLocation.lng.toFixed(6)}`

              : (
                  profile.location ||
                  ''
                ),


          customerLat:
            userLocation?.lat ??
            null,


          customerLng:
            userLocation?.lng ??
            null,


          amount: 0,

          status: 'pending',

          createdAt:
            serverTimestamp()

        }
      );


      alert(
        `Service request sent to ${selectedWorker.name}.`
      );


      requestModal
        .classList.add('hidden');


      event.target.reset();

      await loadCustomerRequests();

    } catch (error) {

      console.error(error);

      alert(
        'Could not send request: ' +
        error.message
      );
    }
  };


/* =========================================================
   CUSTOMER REQUEST TRACKING + REVIEWS
========================================================= */
const customerRequestsSection = $('myRequests');
const customerRequestsList = $('customerRequestsList');

function requestDate(value) {
  if (!value) return '';
  const d = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });
}

const REVIEW_VISIBLE_MS = 24 * 60 * 60 * 1000;

function shouldShowCustomerRequest(request) {
  if (request.reviewSubmitted !== true) return true;

  const reviewedAt = request.reviewedAt;
  if (!reviewedAt) return true;

  const reviewedDate =
    typeof reviewedAt.toDate === 'function'
      ? reviewedAt.toDate()
      : new Date(reviewedAt);

  if (Number.isNaN(reviewedDate.getTime())) return true;

  return Date.now() - reviewedDate.getTime() < REVIEW_VISIBLE_MS;
}

async function loadCustomerRequests() {
  const user = auth.currentUser;
  if (!user || !customerRequestsSection || !customerRequestsList) return;

  const profileSnap = await getDoc(doc(db, 'users', user.uid));
  const profile = profileSnap.exists() ? profileSnap.data() : {};

  // Both customers and service providers can view
// the requests they personally submitted.

if (!['user', 'worker'].includes(profile.role || 'user')) {
  customerRequestsSection.classList.add('hidden');
  return;
}

  customerRequestsSection.classList.remove('hidden');
  customerRequestsList.innerHTML =
    '<div class="worker-empty">Loading your requests...</div>';

  try {
    const snap = await getDocs(
      query(collection(db, 'requests'), where('customerId', '==', user.uid))
    );

    const allRows = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) =>
        (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      );

    const rows = allRows.filter(shouldShowCustomerRequest);

    if (!rows.length) {
      customerRequestsList.innerHTML =
        '<div class="worker-empty">No active or recent service requests.</div>';
      return;
    }

    customerRequestsList.innerHTML = rows.map(r => {
      const status = r.status || 'pending';
      const provider = r.providerSnapshot || {};
      const reviewed = r.reviewSubmitted === true;
      const paidAmount = Number(r.paymentAmount ?? r.amount ?? 0);

      const reviewBox =
        status === 'completed' && !reviewed
          ? `
            <form class="review-form"
                  data-review-request="${r.id}"
                  data-provider="${r.providerId || ''}">
              <strong>Rate this completed job</strong>

              <div class="star-picker" data-stars>
                ${[1,2,3,4,5]
                  .map(n =>
                    `<button type="button"
                             class="review-star"
                             data-value="${n}"
                             aria-label="${n} star">☆</button>`
                  ).join('')}
              </div>

              <input type="hidden" name="rating" value="0">

              <textarea
                name="review"
                maxlength="500"
                placeholder="Write a short review (optional)"></textarea>

              <button class="btn btn-primary" type="submit">
                Submit Review
              </button>
            </form>`
          : reviewed
            ? `<div class="review-thanks">
                 ⭐ Your review was submitted. This item will leave this page after 24 hours.
               </div>`
            : '';

      return `
        <article class="customer-request-card">
          <div class="customer-request-head">
            <div>
              <h3>${escapeHtml(r.serviceType || 'Service')}</h3>
              <p>
                ${escapeHtml(provider.name || 'Service Provider')}
                • ${requestDate(r.createdAt)}
              </p>
            </div>
            <span class="request-status ${status}">
              ${escapeHtml(status)}
            </span>
          </div>

          <p>${escapeHtml(r.description || 'No description')}</p>

          ${status === 'accepted'
            ? '<div class="request-progress">🔧 Provider accepted your request. Job in progress.</div>'
            : ''}

          ${status === 'completed'
            ? `<div class="request-progress completed">
                 ✅ Provider marked this job completed.
                 <br>💵 Paid: ${Number(paidAmount).toLocaleString('en-LK', {
                   style: 'currency',
                   currency: 'LKR',
                   maximumFractionDigits: 2
                 })}
               </div>`
            : ''}

          ${status === 'rejected'
            ? '<div class="request-progress rejected">Request was declined by the provider.</div>'
            : ''}

          ${reviewBox}
        </article>`;
    }).join('');

  } catch (error) {
    console.error('Customer requests error:', error);
    customerRequestsList.innerHTML =
      `<div class="worker-empty">
        Could not load your requests: ${escapeHtml(error.message)}
       </div>`;
  }
}

customerRequestsList?.addEventListener('click', event => {
  const star = event.target.closest('.review-star');
  if (!star) return;
  const form = star.closest('.review-form');
  const value = Number(star.dataset.value);
  form.querySelector('input[name="rating"]').value = String(value);
  form.querySelectorAll('.review-star').forEach(btn => {
    btn.textContent = Number(btn.dataset.value) <= value ? '★' : '☆';
    btn.classList.toggle('selected', Number(btn.dataset.value) <= value);
  });
});

customerRequestsList?.addEventListener('submit', async event => {
  const form = event.target.closest('.review-form');
  if (!form) return;
  event.preventDefault();
  const user = auth.currentUser;
  const rating = Number(form.querySelector('input[name="rating"]').value);
  const review = form.querySelector('textarea[name="review"]').value.trim();
  const requestId = form.dataset.reviewRequest;
  const providerId = form.dataset.provider;
  if (!user || rating < 1 || rating > 5) {
    alert('Please choose a rating from 1 to 5 stars.');
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const reqRef = doc(db, 'requests', requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) throw new Error('Request not found.');
    const req = reqSnap.data();
    if (req.customerId !== user.uid || req.status !== 'completed' || req.reviewSubmitted === true) {
      throw new Error('This request cannot be reviewed.');
    }
    await setDoc(doc(db, 'reviews', requestId), {
      requestId, providerId, customerId: user.uid, rating, review,
      customerName: req.customerSnapshot?.name || 'Customer', createdAt: serverTimestamp()
    });
    await updateDoc(reqRef, { reviewSubmitted: true, rating, review, reviewedAt: serverTimestamp() });

    const reviewSnap = await getDocs(query(collection(db, 'reviews'), where('providerId', '==', providerId)));
    const ratings = reviewSnap.docs.map(d => Number(d.data().rating)).filter(n => n >= 1 && n <= 5);
    const average = ratings.length ? ratings.reduce((a,b) => a+b, 0) / ratings.length : 0;
    await updateDoc(doc(db, 'users', providerId), { rating: average, reviewCount: ratings.length });
    await loadCustomerRequests();
    await loadWorkers();
    alert('Thank you! Your review was submitted.');
  } catch (error) {
    console.error(error);
    alert('Could not submit review: ' + error.message);
    button.disabled = false;
  }
});

$('refreshCustomerRequests')?.addEventListener('click', loadCustomerRequests);

/* =========================================================
   AUTHENTICATION
========================================================= */

const authModal =
  $('authModal');


let selectedRole = null;

let authMode = 'login';



const nameField =
  $('nameField');

const phoneField =
  $('phoneField');

const providerFields =
  $('providerFields');


const nameInput =
  $('nameInput');

const emailInput =
  $('emailInput');

const phoneInput =
  $('phoneInput');

const locationInput =
  $('locationInput');

const experienceInput =
  $('experienceInput');

const descriptionInput =
  $('descriptionInput');

const passwordInput =
  $('passwordInput');

const authSubmitBtn =
  $('authSubmitBtn');

const switchAuthText =
  $('switchAuthText');


/* =========================================================
   AUTH UI - Full-screen Login / Register tabs
========================================================= */
function openAuthModal(mode = 'login') {
  selectedRole = 'user';
  providerLocation = null;
  authModal.classList.remove('hidden');
  document.body.classList.add('auth-open');
  showAuthForm(mode);
}

function selectRole(role) {
  if (!['user', 'worker'].includes(role)) return;
  selectedRole = role;
  document.querySelectorAll('#authModal [data-role-choice]').forEach(button => {
    const active = button.dataset.roleChoice === role;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  showAuthForm(authMode);
}

function closeAuthModal() {
  authModal.classList.add('hidden');
  document.body.classList.remove('auth-open');
}

/* =========================================================
   PROVIDER LOCATION PICKER MAP
========================================================= */

function initProviderPicker() {

  setTimeout(
    () => {

      if (!providerPickerMap) {

        providerPickerMap =
          L.map(
            'providerLocationMap'
          )
            .setView(
              [7.8731, 80.7718],
              7
            );


        L.tileLayer(

          'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',

          {

            maxZoom: 19,

            attribution:
              '© OpenStreetMap contributors'

          }

        ).addTo(
          providerPickerMap
        );


        providerPickerMap
          .on(
            'click',
            event => {

              setProviderPin(

                event.latlng.lat,

                event.latlng.lng

              );
            }
          );
      }


      providerPickerMap
        .invalidateSize();

    },

    100
  );
}


/* =========================================================
   SET PROVIDER MAP PIN
========================================================= */

function setProviderPin(
  lat,
  lng
) {

  providerLocation = {
    lat,
    lng
  };


  if (providerPickerMarker) {

    providerPickerMap
      .removeLayer(
        providerPickerMarker
      );
  }


  providerPickerMarker =
    L.marker([
      lat,
      lng
    ])

      .addTo(
        providerPickerMap
      )

      .bindPopup(
        'Your service location'
      )

      .openPopup();


  providerPickerMap
    .setView(
      [lat, lng],
      15
    );


  $('providerLocationStatus')
    .textContent =

      `Selected: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}


/* =========================================================
   PROVIDER CURRENT LOCATION
========================================================= */

$('useProviderLocationBtn')
  .addEventListener(
    'click',
    () => {

      if (!navigator.geolocation) {

        alert(
          'Geolocation is not supported.'
        );

        return;
      }


      $('providerLocationStatus')
        .textContent =
          'Getting your current location...';


      navigator.geolocation
        .getCurrentPosition(

          position => {

            setProviderPin(

              position.coords.latitude,

              position.coords.longitude

            );

          },


          () => {

            $('providerLocationStatus')
              .textContent =
                'Could not get location. Tap the map to select manually.';

          },


          {

            enableHighAccuracy: true,

            timeout: 10000

          }
        );
    }
  );


/* =========================================================
   AUTH MODE + CONTROLS
========================================================= */
function showAuthForm(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  const worker = selectedRole === 'worker';
  const reg = authMode === 'register';
  const heading = $('modalTitle');

  $('authLoginTab').classList.toggle('active', !reg);
  $('authRegisterTab').classList.toggle('active', reg);
  $('authLoginTab').setAttribute('aria-selected', String(!reg));
  $('authRegisterTab').setAttribute('aria-selected', String(reg));

  heading.textContent = reg ? 'Create your account' : 'Welcome back';
  $('modalSubtitle').textContent = reg
    ? 'Join Onawadak.lk and get started in minutes.'
    : 'Sign in to access your service requests and account.';

  nameField.classList.toggle('hidden', !reg);
  phoneField.classList.toggle('hidden', !reg);
  providerFields.classList.toggle('hidden', !(worker && reg));
  nameInput.required = reg;
  phoneInput.required = reg;
  locationInput.required = worker && reg;
  passwordInput.autocomplete = reg ? 'new-password' : 'current-password';
  passwordInput.type = 'password';
  $('togglePasswordVisibility').textContent = 'Show';
  passwordInput.value = '';
  authSubmitBtn.textContent = reg ? 'Create Account' : 'Login';
  $('forgotPasswordBtn').classList.toggle('hidden', reg);
  switchAuthText.innerHTML = reg
    ? 'Already have an account? <button type="button" id="switchAuthBtn">Login</button>'
    : 'New to Onawadak? <button type="button" id="switchAuthBtn">Create an account</button>';
  $('switchAuthBtn').onclick = () => showAuthForm(reg ? 'login' : 'register');

  if (worker && reg) initProviderPicker();
}

$('loginBtn').addEventListener('click', () => openAuthModal('login'));
$('registerBtn').addEventListener('click', () => openAuthModal('register'));
$('authLoginTab').addEventListener('click', () => showAuthForm('login'));
$('authRegisterTab').addEventListener('click', () => showAuthForm('register'));
$('closeModal').addEventListener('click', closeAuthModal);

$('togglePasswordVisibility').addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  $('togglePasswordVisibility').textContent = show ? 'Hide' : 'Show';
  $('togglePasswordVisibility').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

document.querySelectorAll('#authModal [data-role-choice]').forEach(button => {
  button.addEventListener('click', () => selectRole(button.dataset.roleChoice));
});

authModal.addEventListener('click', event => {
  if (event.target === authModal) closeAuthModal();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !authModal.classList.contains('hidden')) closeAuthModal();
});

/* =========================================================
   FORGOT PASSWORD
========================================================= */

$('forgotPasswordBtn')
  .addEventListener(
    'click',
    async () => {

      const email =
        emailInput
          .value
          .trim()
          .toLowerCase();


      if (!email) {

        alert(
          'Enter your email address first, then click Forgot password.'
        );

        return;
      }


      try {

        await sendPasswordResetEmail(
          auth,
          email
        );


        alert(
          'Password reset email sent. Check your inbox and spam folder.'
        );


      } catch (error) {

        console.error(error);

        alert(
          firebaseErrorMessage(
            error
          )
        );
      }
    }
  );


/* =========================================================
   FIREBASE ERROR MESSAGE
========================================================= */

function firebaseErrorMessage(
  error
) {

  const code =
    error?.code;


  if (
    code ===
    'auth/email-already-in-use'
  ) {

    return 'This email is already registered.';
  }


  if (
    code ===
    'auth/invalid-email'
  ) {

    return 'Please enter a valid email address.';
  }


  if (
    code ===
    'auth/weak-password'
  ) {

    return 'Password must be at least 6 characters.';
  }


  if (
    [
      'auth/invalid-credential',
      'auth/wrong-password',
      'auth/user-not-found'
    ].includes(code)
  ) {

    return 'Invalid email or password.';
  }


  if (
    code ===
    'auth/too-many-requests'
  ) {

    return 'Too many attempts. Please try again later.';
  }


  return (
    error?.message ||
    'Something went wrong.'
  );
}


/* =========================================================
   REGISTER / LOGIN
========================================================= */

$('authForm').onsubmit =
  async event => {

    event.preventDefault();


    if (!selectedRole) {

      alert(
        'Choose Customer or Service Provider first.'
      );

      return;
    }


    const email =
      emailInput
        .value
        .trim()
        .toLowerCase();


    const password =
      passwordInput.value;


    authSubmitBtn.disabled =
      true;


    const oldText =
      authSubmitBtn.textContent;


    authSubmitBtn.textContent =

      authMode === 'register'

        ? 'Creating...'

        : 'Logging in...';


    try {

      /* =================================================
         REGISTER
      ================================================= */

      if (
        authMode ===
        'register'
      ) {


        if (
          selectedRole === 'worker' &&
          !providerLocation
        ) {

          throw new Error(
            'Please select your service location on the map.'
          );
        }


        if (selectedRole === 'worker' && getSelectedProviderServices().length === 0) {
          throw new Error('Please select at least one service.');
        }

        const credential =
          await createUserWithEmailAndPassword(

            auth,

            email,

            password

          );


        const profile = {

          uid:
            credential.user.uid,

          role:
            selectedRole,

          name:
            nameInput
              .value
              .trim(),

          email,

          phone:
            phoneInput
              .value
              .trim(),

          createdAt:
            serverTimestamp()

        };


        /* Worker fields */

        if (
          selectedRole ===
          'worker'
        ) {

          Object.assign(
            profile,
            {

              services: getSelectedProviderServices(),

              // Keep legacy `service` for compatibility with existing code.
              service: getSelectedProviderServices()[0],

              location:
                locationInput
                  .value
                  .trim(),

              lat:
                providerLocation.lat,

              lng:
                providerLocation.lng,

              experience:
                experienceInput
                  .value
                  .trim(),

              description:
                descriptionInput
                  .value
                  .trim(),

              rating: 0,

              reviewCount: 0,

              available: true

            }
          );
        }


        await setDoc(

          doc(
            db,
            'users',
            credential.user.uid
          ),

          profile

        );


        /* Worker */

        if (
          selectedRole ===
          'worker'
        ) {

          window.location.href =
            'provider-profile.html';

        }

        /* Customer */

        else {

          alert(
            'Customer account created successfully.'
          );


          closeAuthModal();


          event.target.reset();


          await updateNavbarForLoggedInUser(
            credential.user
          );
        }

      }


      /* =================================================
         LOGIN
      ================================================= */

      else {

        const credential =
          await signInWithEmailAndPassword(

            auth,

            email,

            password

          );


        const snap =
          await getDoc(

            doc(
              db,
              'users',
              credential.user.uid
            )
          );


        if (!snap.exists()) {

          await signOut(auth);

          throw new Error(
            'Account profile not found in Firestore.'
          );
        }


        const profile =
          snap.data();


        if (
          (profile.role || 'user')
          !== selectedRole
        ) {

          await signOut(auth);

          throw new Error(
            'This account belongs to a different account type.'
          );
        }


        /* Worker */

        if (
          selectedRole ===
          'worker'
        ) {

          window.location.href =
            'provider-profile.html';

        }

        /* Customer */

        else {

          closeAuthModal();


          event.target.reset();


          await updateNavbarForLoggedInUser(
            credential.user
          );
        }
      }


    } catch (error) {

      console.error(error);

      alert(
        firebaseErrorMessage(
          error
        )
      );


    } finally {

      authSubmitBtn.disabled =
        false;


      authSubmitBtn.textContent =
        oldText;
    }
  };


/* =========================================================
   NAVBAR LOGGED USER
========================================================= */

async function updateNavbarForLoggedInUser(
  firebaseUser = auth.currentUser
) {

  const loggedOut =
    $('loggedOutActions');


  const loggedIn =
    $('loggedInActions');


  if (
    !loggedOut ||
    !loggedIn
  ) {

    return;
  }


  if (!firebaseUser) {

    loggedOut
      .classList.remove('hidden');


    loggedIn
      .classList.add('hidden');

    customerRequestsSection?.classList.add('hidden');
    return;
  }


  let profile = {};


  try {

    const snap =
      await getDoc(

        doc(
          db,
          'users',
          firebaseUser.uid
        )
      );


    if (snap.exists()) {

      profile =
        snap.data();

    }

  } catch (error) {

    console.error(error);
  }


  const name =

    profile.name ||

    firebaseUser.email
      ?.split('@')[0] ||

    'User';


  const role =

    profile.role ||

    'user';


  loggedOut
    .classList.add('hidden');


  loggedIn
    .classList.remove('hidden');


  $('navUserName')
    .textContent =
      name;


  $('dropdownUserName')
    .textContent =
      name;


  $('dropdownUserRole')
    .textContent =

      role === 'worker'

        ? '🔧 Service Provider'

        : '👤 Customer';


  $('providerProfileLink')
    .classList.toggle(

      'hidden',

      role !== 'worker'

    );

  if (role === 'user' || role === 'worker') {
  await loadCustomerRequests();
} else {
  customerRequestsSection?.classList.add('hidden');
}
}


/* =========================================================
   USER DROPDOWN
========================================================= */

$('userNameBtn')
  .addEventListener(
    'click',
    event => {

      event.stopPropagation();

      $('userDropdown')
        .classList
        .toggle('hidden');

    }
  );


document
  .addEventListener(
    'click',
    () => {

      $('userDropdown')
        .classList
        .add('hidden');

    }
  );


/* =========================================================
   LOGOUT
========================================================= */

$('homeLogoutBtn')
  .addEventListener(
    'click',
    async () => {

      await signOut(auth);

    }
  );


/* =========================================================
   AUTH STATE
========================================================= */

onAuthStateChanged(
  auth,
  updateNavbarForLoggedInUser
);


/* =========================================================
   MOBILE NAVIGATION
========================================================= */

const menuBtn = document.getElementById('menuBtn');
const mobileNav = document.querySelector('nav');

if (menuBtn && mobileNav) {

  menuBtn.addEventListener('click', event => {

    event.stopPropagation();

    mobileNav.classList.toggle(
      'mobile-nav-open'
    );

  });


  mobileNav
    .querySelectorAll('a')
    .forEach(link => {

      link.addEventListener(
        'click',
        () => {

          mobileNav.classList.remove(
            'mobile-nav-open'
          );

        }
      );

    });


  document.addEventListener(
    'click',
    event => {

      if (
        !mobileNav.contains(event.target) &&
        !menuBtn.contains(event.target)
      ) {

        mobileNav.classList.remove(
          'mobile-nav-open'
        );

      }

    }
  );

}

/* =========================================================
   HERO SLIDER
========================================================= */

const slides =
  document.querySelectorAll(
    '.hero-card.slider .slide'
  );


const dots =
  document.querySelectorAll(
    '.slider-dots .dot'
  );


let currentSlide = 0;


function showSlide(index) {

  slides.forEach(
    slide => {

      slide.classList
        .remove('active');

    }
  );


  dots.forEach(
    dot => {

      dot.classList
        .remove('active-dot');

    }
  );


  slides[index]
    ?.classList
    .add('active');


  dots[index]
    ?.classList
    .add('active-dot');
}


/* Click slider dots */

dots.forEach(
  (dot, index) => {

    dot.addEventListener(
      'click',
      () => {

        currentSlide =
          index;

        showSlide(
          currentSlide
        );
      }
    );

  }
);


/* Auto slider */

if (slides.length > 1) {

  setInterval(
    () => {

      currentSlide++;


      if (
        currentSlide >=
        slides.length
      ) {

        currentSlide = 0;

      }


      showSlide(
        currentSlide
      );

    },

    4000
  );
}


/* =========================================================
   START WEBSITE
========================================================= */

loadWorkers();


/* =========================================================
   FIX MAP ON WINDOW RESIZE
========================================================= */

window.addEventListener(
  'resize',
  () => {

    fixNearbyMapSize();

  }
);