One Infinity ERP — "Draft Application" sidebar tab
==========================================

Kya add hua:
  Sidebar mein "Applications" ke niche aur "Call/Chat" ke upar ek naya
  tab "Draft Application" — isme sirf status = "Draft Submitted" wali
  applications dikhengi. Status-switcher bar (All/Under Review/etc.) is
  page par nahi dikhega, taaki galti se doosre status pe switch na ho
  jaye — ye page hamesha sirf Draft Submitted dikhayega.

Baaki sab kaam wahi hai jo already Applications page mein tha (same
row actions: Accept, status change, chat, document review, edit) —
is step mein sirf NAVIGATION + FILTER add kiya hai. "Assign Staff hatana"
aur "Accept/Reject tak actions restrict karna, aur kisne kya field bhara
uska log rakhna" — ye abhi implement NAHI kiya, kyunki wo alag,
bada kaam hai (naya audit-log table chahiye hoga) — jab confirm karo
scope, wo agla step hoga.

Files (already patched, ready to drop in):
  Applications.jsx  → src/pages/Applications.jsx  (replace)
  App.jsx            → src/App.jsx                 (replace)
  Sidebar.jsx         → src/components/Sidebar.jsx  (replace)

Agar aap already-modified versions rakhna chahte ho aur sirf ye
changes lagana chahte ho (jaise agar aapne DealerPortal.jsx jaisa kuch
aur bhi change kar rakha hai), to .diff files use kar lo:
  Applications.jsx.diff
  App.jsx.diff
  Sidebar.jsx.diff
(git apply Applications.jsx.diff  -- ya manually patch karke)

Teeno files esbuild se syntax-check ho chuki hain, koi error nahi.

After copying files:
  npm run build   (ya npm run dev se local test)
