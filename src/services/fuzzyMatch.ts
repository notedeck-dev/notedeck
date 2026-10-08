/** Query の全文字が label 内に順番通りに出現するか (subsequence match) */
export function fuzzyMatch(query: string, label: string): boolean {
  const q = query.toLowerCase()
  const l = label.toLowerCase()
  let qi = 0
  for (let li = 0; li < l.length && qi < q.length; li++) {
    if (l[li] === q[qi]) qi++
  }
  return qi === q.length
}
