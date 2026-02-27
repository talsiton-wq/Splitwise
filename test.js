// ─── Quick test runner for core logic ─────────────────────────────────────
let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗  ${name}`);
    console.log(`       ${e.message}`);
    failed++;
  }
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${b}, got ${a}`);
}

function near(a, b, msg, tol = 0.02) {
  if (Math.abs(a - b) > tol) throw new Error(msg || `expected ≈${b}, got ${a}`);
}

// ─── Paste logic from splits.html ─────────────────────────────────────────
const exchangeRates = { ILS:1, USD:0.273, EUR:0.252, GBP:0.215, JPY:41.5, JOD:0.194, HUF:100.5 };

function toILS(amount, currency) {
  if (!currency || currency === 'ILS') return amount;
  const rate = exchangeRates?.[currency];
  return (rate && rate !== 0) ? +(amount / rate).toFixed(4) : amount;
}

function calcBalances(groupData) {
  const members  = groupData.members;
  const expenses = Object.values(groupData.expenses || {});
  const payments = Object.values(groupData.payments || {});
  const ids      = Object.keys(members);
  if (!ids.length) return {};

  const bal = {};
  ids.forEach(id => bal[id] = 0);

  payments.forEach(p => {
    const amt = p.amountILS ?? p.amount ?? 0;
    if (p.paidBy in bal) bal[p.paidBy] += amt;
    if (p.paidTo in bal) bal[p.paidTo] -= amt;
  });

  expenses.forEach(e => {
    const amt = e.amountILS ?? e.amount ?? 0;

    if (e.type === 'payment') {
      if (e.paidBy in bal) bal[e.paidBy] += amt;
      if (e.paidTo in bal) bal[e.paidTo] -= amt;
      return;
    }

    const sa = e.splitAmong;
    const isCustom = sa && !Array.isArray(sa) && typeof sa === 'object';

    if (isCustom) {
      Object.entries(sa).forEach(([id, share]) => {
        if (id in bal) bal[id] -= share;
      });
    } else if (Array.isArray(sa)) {
      const valid = sa.filter(id => id in bal);
      if (!valid.length) return;
      const share = amt / valid.length;
      valid.forEach(id => { bal[id] -= share; });
    } else {
      const share = amt / ids.length;
      ids.forEach(id => { bal[id] -= share; });
    }
    if (e.paidBy in bal) bal[e.paidBy] += amt;
  });

  ids.forEach(id => { bal[id] = Math.round(bal[id]*100)/100; });
  return bal;
}

function calcTransfers(bal) {
  const creds = [], debts = [];
  Object.entries(bal).forEach(([id, b]) => {
    if (b >  0.01) creds.push({ id, v: b });
    if (b < -0.01) debts.push({ id, v: -b });
  });
  creds.sort((a,b) => b.v - a.v);
  debts.sort((a,b) => b.v - a.v);
  const out = [];
  let ci=0, di=0;
  while (ci < creds.length && di < debts.length) {
    const c = creds[ci], d = debts[di];
    const amt = Math.min(c.v, d.v);
    if (amt > 0.01) out.push({ from: d.id, to: c.id, amount: Math.round(amt*100)/100 });
    c.v -= amt; d.v -= amt;
    if (c.v < 0.01) ci++;
    if (d.v < 0.01) di++;
  }
  return out;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

console.log('\n── toILS ─────────────────────────────────────────────');

test('ILS stays the same', () => {
  eq(toILS(100, 'ILS'), 100);
});

test('undefined currency stays the same', () => {
  eq(toILS(100, undefined), 100);
});

test('USD → ILS conversion', () => {
  // $100 / 0.273 ≈ 366.3
  near(toILS(100, 'USD'), 366.3, 'USD conversion wrong', 1);
});

test('EUR → ILS conversion', () => {
  near(toILS(100, 'EUR'), 396.8, 'EUR conversion wrong', 1);
});


console.log('\n── calcBalances: שקל רגיל ────────────────────────────');

test('חלוקה שווה בין שניים — יתרות מתאזנות לאפס', () => {
  const g = {
    members: { a: {name:'Alice'}, b: {name:'Bob'} },
    expenses: {
      e1: { description:'ארוחה', amount:100, amountILS:100, paidBy:'a' }
    }
  };
  const bal = calcBalances(g);
  near(bal.a,  50, 'Alice should be +50');
  near(bal.b, -50, 'Bob should be -50');
  near(bal.a + bal.b, 0, 'sum should be 0');
});

test('חלוקה שווה בין שלושה', () => {
  const g = {
    members: { a:{name:'A'}, b:{name:'B'}, c:{name:'C'} },
    expenses: {
      e1: { amount:90, amountILS:90, paidBy:'a' }
    }
  };
  const bal = calcBalances(g);
  near(bal.a,  60);
  near(bal.b, -30);
  near(bal.c, -30);
});

test('כל סכום היתרות מסתכם לאפס', () => {
  const g = {
    members: { a:{name:'A'}, b:{name:'B'}, c:{name:'C'} },
    expenses: {
      e1: { amount:90, amountILS:90, paidBy:'a' },
      e2: { amount:60, amountILS:60, paidBy:'b' }
    }
  };
  const bal = calcBalances(g);
  near(Object.values(bal).reduce((s,v)=>s+v,0), 0, 'sum != 0');
});


console.log('\n── calcBalances: מטבע זר ──────────────────────────────');

test('הוצאה בדולר — חלוקה שווה בשקלים', () => {
  const amountILS = toILS(100, 'USD'); // ≈ 366.3
  const g = {
    members: { a:{name:'A'}, b:{name:'B'} },
    expenses: {
      e1: { amount:100, currency:'USD', amountILS, paidBy:'a' }
    }
  };
  const bal = calcBalances(g);
  near(bal.a,  amountILS/2, 'A should be +half');
  near(bal.b, -amountILS/2, 'B should be -half');
  near(bal.a + bal.b, 0);
});

test('הוצאה בדולר — חלוקה מותאמת (כל אחד הזין $ → נשמר ₪)', () => {
  // User entered $60 for A and $40 for B in a $100 USD expense
  const aShare = toILS(60, 'USD');
  const bShare = toILS(40, 'USD');
  const amountILS = toILS(100, 'USD');
  const g = {
    members: { a:{name:'A'}, b:{name:'B'} },
    expenses: {
      e1: {
        amount:100, currency:'USD', amountILS, paidBy:'a',
        splitAmong: { a: aShare, b: bShare }  // stored in ILS after conversion
      }
    }
  };
  const bal = calcBalances(g);
  // A paid full, owes aShare → net = amountILS - aShare = bShare
  near(bal.a,  bShare, 'A net should equal B share');
  near(bal.b, -bShare, 'B should owe bShare');
  near(bal.a + bal.b, 0);
});


console.log('\n── calcBalances: החזרות ────────────────────────────────');

test('החזרה מבטלת חוב', () => {
  const g = {
    members: { a:{name:'A'}, b:{name:'B'} },
    expenses: {
      e1: { amount:100, amountILS:100, paidBy:'a' }
    },
    payments: {
      p1: { amount:50, amountILS:50, paidBy:'b', paidTo:'a' }
    }
  };
  const bal = calcBalances(g);
  near(bal.a,   0, 'A should be 0 after partial payment');
  near(bal.b,   0, 'B should be 0 after partial payment');
});

test('החזרה לגאסי (בתוך expenses) לא נחשבת כהוצאה', () => {
  const g = {
    members: { a:{name:'A'}, b:{name:'B'} },
    expenses: {
      e1: { amount:100, amountILS:100, paidBy:'a' },
      p1: { type:'payment', amount:50, amountILS:50, paidBy:'b', paidTo:'a' }
    }
  };
  const bal = calcBalances(g);
  near(bal.a,   0);
  near(bal.b,   0);
});


console.log('\n── סה"כ הוצאות בכרטיסית בית ─────────────────────────');

test('לא כולל payments בסה"כ', () => {
  const expenses = {
    e1: { amount:100, amountILS:100 },
    p1: { type:'payment', amount:50, amountILS:50 }
  };
  const total = Object.values(expenses)
    .filter(e => e.type !== 'payment')
    .reduce((s,e) => s+(e.amountILS ?? e.amount ?? 0), 0);
  eq(total, 100, `total should be 100 not ${total}`);
});


console.log('\n── calcTransfers ──────────────────────────────────────');

test('העברה אחת מספיקה לאיזון', () => {
  const bal = { a: 50, b: -50 };
  const t = calcTransfers(bal);
  eq(t.length, 1);
  eq(t[0].from, 'b');
  eq(t[0].to,   'a');
  eq(t[0].amount, 50);
});

test('שלושה אנשים — מינימום העברות', () => {
  // A paid everything, B and C each owe 30
  const bal = { a: 60, b: -30, c: -30 };
  const t = calcTransfers(bal);
  eq(t.length, 2);
  near(t.reduce((s,x)=>s+x.amount,0), 60, 'total transfers should equal debt');
});


// ─── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`${'─'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
