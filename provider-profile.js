import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import {
  collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const $ = id => document.getElementById(id);
let currentProvider = null;
let requests = [];

const PROVIDER_SERVICES = ['Mechanic', 'Towing', 'Battery', 'Tyre Repair', 'Electrician', 'Plumber', 'AC Repair', 'Locksmith', 'IT Support', 'Mobile Repair', 'Cleaning', 'Carpenter', 'Other'];
function providerServices(provider) {
  if (Array.isArray(provider.services) && provider.services.length) return provider.services;
  return provider.service ? [provider.service] : [];
}

const money = v => 'Rs. ' + Number(v || 0).toLocaleString('en-LK', { maximumFractionDigits: 2 });

function safeDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(v) {
  const d = safeDate(v);
  return d ? d.toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not specified';
}

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  setTimeout(() => $('toast').classList.add('hidden'), 2600);
}

function setAvailabilityUI(available) {
  $('availabilityPill').className = 'availability ' + (available ? 'available' : 'offline');
  $('availabilityPill').textContent = available ? '● Available' : '● Unavailable';
  $('toggleAvailabilityBtn').textContent = available ? 'Set Unavailable' : 'Set Available';
}

async function loadProvider() {
  const user = auth.currentUser;
  if (!user) return;

  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) throw new Error('Provider profile not found.');

  currentProvider = { uid: user.uid, ...snap.data() };

  if (currentProvider.role !== 'worker') {
    alert('This dashboard is for Service Providers only.');
    location.href = 'index.html';
    return;
  }

  $('providerName').textContent = currentProvider.name || 'Service Provider';
  setAvailabilityUI(currentProvider.available !== false);
}

async function loadRequests() {
  const user = auth.currentUser;
  if (!user) return;

  const snap = await getDocs(
    query(collection(db, 'requests'), where('providerId', '==', user.uid))
  );

  requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  requests.sort((a, b) =>
    (safeDate(b.createdAt)?.getTime() || 0) - (safeDate(a.createdAt)?.getTime() || 0)
  );

  renderRequests();
  updateStats();
}

function renderRequests() {
  const filter = $('requestFilter').value;
  const list = filter === 'all'
    ? requests
    : requests.filter(r => (r.status || 'pending') === filter);

  if (!list.length) {
    $('requestsList').innerHTML =
      `<div class="empty">No ${filter === 'all' ? '' : filter + ' '}requests found.</div>`;
    return;
  }

  $('requestsList').innerHTML = list.map(r => {
    const status = r.status || 'pending';
    const customer = r.customerSnapshot || {};
    const requesterRole =
  customer.role || r.customerRole || 'user';

const requesterType =
  requesterRole === 'worker'
    ? '🔧 Service Provider'
    : '👤 Customer';
    const paidAmount = Number(r.paymentAmount ?? r.amount ?? 0);

    let actions =
      `<button class="customer-btn" data-action="customer" data-id="${r.id}">👤 Customer Details</button>`;

    if (status === 'pending') {
      actions +=
        `<button class="accept-btn" data-action="accept" data-id="${r.id}">✓ Accept</button>
         <button class="reject-btn" data-action="reject" data-id="${r.id}">✕ Reject</button>`;
    }

    if (status === 'accepted') {
      actions +=
        `<button class="complete-btn" data-action="complete" data-id="${r.id}">✓ Mark Completed</button>`;
    }

    const paymentHtml = status === 'completed'
      ? `<div class="payment-record">💵 Customer Paid: ${money(paidAmount)}</div>`
      : '';

    return `
      <article class="request-card">
        <div class="request-top">
          <div>
            <div class="request-title">${escapeHtml(r.serviceType || 'Service Request')}</div>
            <div class="request-meta">
              From ${escapeHtml(customer.name || 'User')}
• ${requesterType}
• ${formatDate(r.createdAt)}
            </div>
          </div>
          <span class="status ${status}">${escapeHtml(status)}</span>
        </div>

        <div class="request-info">
          <div><span>📍 Location</span><strong>${escapeHtml(customer.location || r.location || 'Not specified')}</strong></div>
          <div><span>💵 Job Amount</span><strong>${money(status === 'completed' ? paidAmount : r.amount)}</strong></div>
          <div><span>📞 Phone</span><strong>${escapeHtml(customer.phone || 'Not provided')}</strong></div>
          <div><span>📝 Description</span><strong>${escapeHtml(r.description || 'No description')}</strong></div>
        </div>

        ${paymentHtml}
        <div class="request-actions">${actions}</div>
      </article>`;
  }).join('');
}

function updateStats() {
  const pending = requests.filter(r => (r.status || 'pending') === 'pending').length;
  const active = requests.filter(r => r.status === 'accepted').length;
  const completed = requests.filter(r => r.status === 'completed').length;
  const now = new Date();

  const completedRows = requests.filter(r => r.status === 'completed');

  const currentMonth = completedRows.filter(r => {
    const d = safeDate(r.completedAt || r.updatedAt || r.createdAt);
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const getPaid = r => Number(r.paymentAmount ?? r.amount ?? 0);
  const monthlyRevenue = currentMonth.reduce((sum, r) => sum + getPaid(r), 0);
  const totalRevenue = completedRows.reduce((sum, r) => sum + getPaid(r), 0);

  $('pendingCount').textContent = pending;
  $('activeCount').textContent = active;
  $('completedCount').textContent = completed;
  $('monthlyRevenue').textContent = money(monthlyRevenue);
  $('revenueLarge').textContent = money(monthlyRevenue);
  $('revenueJobs').textContent = currentMonth.length;
  $('averageJob').textContent = money(currentMonth.length ? monthlyRevenue / currentMonth.length : 0);
  $('totalRevenue').textContent = money(totalRevenue);
  $('revenueMonth').textContent =
    now.toLocaleDateString('en-LK', { month: 'long', year: 'numeric' });
}

async function changeStatus(id, status) {
  const r = requests.find(x => x.id === id);
  if (!r) return;

  const update = {
    status,
    providerRespondedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await updateDoc(doc(db, 'requests', id), update);
  r.status = status;
  renderRequests();
  updateStats();
  showToast(`Request ${status}.`);
}

function openCompleteJobModal(request) {
  $('completeRequestId').value = request.id;
  $('paymentAmount').value =
    Number(request.paymentAmount ?? request.amount ?? 0) > 0
      ? Number(request.paymentAmount ?? request.amount)
      : '';
  $('completeJobModal').classList.remove('hidden');
  setTimeout(() => $('paymentAmount').focus(), 50);
}

function closeCompleteJobModal() {
  $('completeJobModal').classList.add('hidden');
  $('completeJobForm').reset();
  $('completeRequestId').value = '';
}

$('completeJobForm').addEventListener('submit', async event => {
  event.preventDefault();

  const requestId = $('completeRequestId').value;
  const amount = Number($('paymentAmount').value);

  if (!requestId || !Number.isFinite(amount) || amount < 0) {
    alert('Please enter a valid payment amount.');
    return;
  }

  const button = event.submitter;
  if (button) button.disabled = true;

  try {
    await updateDoc(doc(db, 'requests', requestId), {
      status: 'completed',
      paymentAmount: amount,
      paymentStatus: 'paid',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      providerRespondedAt: serverTimestamp()
    });

    const r = requests.find(x => x.id === requestId);
    if (r) {
      r.status = 'completed';
      r.paymentAmount = amount;
      r.paymentStatus = 'paid';
      r.completedAt = new Date();
    }

    closeCompleteJobModal();
    renderRequests();
    updateStats();
    showToast('Job completed and payment recorded.');
  } catch (error) {
    console.error(error);
    alert('Could not complete job: ' + error.message);
  } finally {
    if (button) button.disabled = false;
  }
});

function openCustomer(r) {
  const c = r.customerSnapshot || {};
  const requesterRole =
  c.role || r.customerRole || 'user';

const requesterType =
  requesterRole === 'worker'
    ? 'Service Provider'
    : 'Customer';
  $('customerName').textContent =
  `${c.name || 'User'} (${requesterType})`;
  $('customerPhone').textContent = c.phone || 'Not provided';
  $('customerEmail').textContent = c.email || 'Not provided';
  $('customerLocation').textContent = c.location || r.location || 'Not specified';
  $('customerService').textContent = r.serviceType || 'Not specified';
  $('customerDescription').textContent = r.description || 'No description';
  $('customerAmount').textContent = money(r.paymentAmount ?? r.amount);

  const phone = (c.phone || '').replace(/[^\d+]/g, '');
  const callBtn = $('customerCallBtn');
  if (phone) {
    callBtn.href = `tel:${phone}`;
    callBtn.onclick = null;
  } else {
    callBtn.removeAttribute('href');
    callBtn.onclick = event => {
      event.preventDefault();
      alert('Customer has not provided a phone number.');
    };
  }

  const email = (c.email || '').trim();
  const emailBtn = $('customerEmailBtn');
  if (email) {
    emailBtn.href = `mailto:${email}`;
    emailBtn.onclick = null;
  } else {
    emailBtn.removeAttribute('href');
    emailBtn.onclick = event => {
      event.preventDefault();
      alert('Customer has not provided an email address.');
    };
  }
  $('customerModal').classList.remove('hidden');
}

$('requestFilter').onchange = renderRequests;

$('requestsList').onclick = async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const request = requests.find(x => x.id === button.dataset.id);
  if (!request) return;

  const action = button.dataset.action;

  try {
    if (action === 'customer') return openCustomer(request);

    if (action === 'accept' && confirm('Accept this service request?')) {
      await changeStatus(request.id, 'accepted');
    }

    if (action === 'reject' && confirm('Reject this service request?')) {
      await changeStatus(request.id, 'rejected');
    }

    if (action === 'complete') {
      openCompleteJobModal(request);
    }
  } catch (error) {
    console.error(error);
    alert('Could not update request: ' + error.message);
  }
};

$('closeCompleteJobModal').onclick = closeCompleteJobModal;
$('cancelCompleteJob').onclick = closeCompleteJobModal;
$('completeJobModal').onclick = e => {
  if (e.target === $('completeJobModal')) closeCompleteJobModal();
};

$('toggleAvailabilityBtn').onclick = async () => {
  if (!currentProvider) return;
  const value = currentProvider.available === false;

  await updateDoc(doc(db, 'users', auth.currentUser.uid), {
    available: value,
    updatedAt: serverTimestamp()
  });

  currentProvider.available = value;
  setAvailabilityUI(value);
  showToast(value ? 'You are now available.' : 'You are now unavailable.');
};

function closeServiceManager() {
  $('manageServicesModal').classList.add('hidden');
}

function updateManageServiceCount() {
  const count = document.querySelectorAll('#manageServicesOptions input:checked').length;
  $('manageServicesCount').textContent = `${count} service${count === 1 ? '' : 's'} selected`;
}

$('manageServicesBtn').addEventListener('click', () => {
  if (!currentProvider) return;
  const current = providerServices(currentProvider);
  const options = [...new Set([...PROVIDER_SERVICES, ...current])];
  const container = $('manageServicesOptions');
  container.replaceChildren();
  options.forEach(service => {
    const label = document.createElement('label');
    label.className = 'manager-service-choice';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = service;
    checkbox.checked = current.includes(service);
    const span = document.createElement('span');
    span.textContent = service;
    label.append(checkbox, span);
    container.appendChild(label);
  });
  updateManageServiceCount();
  $('manageServicesModal').classList.remove('hidden');
});

$('manageServicesOptions').addEventListener('change', updateManageServiceCount);
$('closeManageServices').addEventListener('click', closeServiceManager);
$('cancelManageServices').addEventListener('click', closeServiceManager);
$('manageServicesModal').addEventListener('click', e => {
  if (e.target === $('manageServicesModal')) closeServiceManager();
});

$('manageServicesForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!auth.currentUser || !currentProvider) return;
  const list = Array.from(document.querySelectorAll('#manageServicesOptions input:checked'))
    .map(el => el.value);
  if (!list.length) return alert('Select at least one service.');
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    await updateDoc(doc(db, 'users', auth.currentUser.uid), {
      services: list,
      service: list[0],
      updatedAt: serverTimestamp()
    });
    currentProvider.services = list;
    currentProvider.service = list[0];
    closeServiceManager();
    showToast('Your services have been updated.');
  } catch (error) {
    console.error(error);
    alert('Could not update services: ' + error.message);
  } finally {
    if (button) button.disabled = false;
  }
});

$('profileBtn').onclick = () =>
  alert(
    `Name: ${currentProvider?.name || ''}\n` +
    `Services: ${providerServices(currentProvider || {}).join(', ')}\n` +
    `Area: ${currentProvider?.location || ''}\n` +
    `Phone: ${currentProvider?.phone || ''}\n` +
    `Rating: ${Number(currentProvider?.reviewCount || 0) ? Number(currentProvider?.rating || 0).toFixed(1) + ' ⭐' : 'New'}`
  );

$('viewProfileQuick').onclick = $('profileBtn').onclick;
$('homeBtn').onclick = () => location.href = 'index.html';

$('refreshBtn').onclick = async () => {
  await loadProvider();
  await loadRequests();
  showToast('Dashboard refreshed.');
};

$('closeCustomerModal').onclick = () => $('customerModal').classList.add('hidden');
$('customerModal').onclick = e => {
  if (e.target === $('customerModal')) $('customerModal').classList.add('hidden');
};

$('logoutBtn').onclick = async () => {
  if (confirm('Do you want to logout?')) {
    await signOut(auth);
    location.href = 'index.html';
  }
};

onAuthStateChanged(auth, async user => {
  if (!user) {
    alert('Please login as a Service Provider first.');
    location.href = 'index.html';
    return;
  }

  try {
    await loadProvider();
    await loadRequests();
  } catch (error) {
    console.error(error);
    alert('Dashboard could not load: ' + error.message);
  }
});
