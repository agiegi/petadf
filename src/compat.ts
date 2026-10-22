// ブラウザの差を埋める。main.ts の一番最初に読み込むこと。
//
// pdf.js 6.4 は Map.prototype.getOrInsertComputed を使っている。
// これは TC39 の提案段階のメソッドで, 載っていないブラウザがまだ多い。
// 無いと PDF の描画が丸ごと失敗し, 白い紙だけが出る状態になる。
// 標準に入って普及したら, このファイルごと消してよい。

if (!('getOrInsertComputed' in Map.prototype)) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value: function <K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V): V {
      if (!this.has(key)) this.set(key, callbackfn(key))
      return this.get(key) as V
    },
    writable: true,
    configurable: true,   // 列挙はさせない。for...in に出ると他所が壊れる
  })
}
