# 學習 vue 3 源碼

## 響應系統
代碼可參考 `feature/reactivity` 分支
### 如何使一個物件能夠變成響應式數據呢?
目前我們有一個函式 effect , 用來更新 `document.body.innterText` 的值， 而變數 `obj.text` 則是我們打算顯示在 `body` 上

當物件值發生變化時，我們希望讓使用到該物件值的地方也隨即發生變化，有兩個線索能夠達到該需求

1. 當 effect 執行時，觸發 `obj.text` 的讀取操作
2. 當修改 `obj.text` 值時，觸發 `obj.text` 設置操作

只要能夠攔截該物件的讀取與設置操作( ES6 proxy )，我們就可以完成響應式數據了

思考流程：
1. 執行 effect -> 觸發讀取操作 -> 將 effect 儲存到桶(bucket)中，使得數據發生變化時，能夠觸發 effect>
2. 設置 `obj.text`時，將 effect 從桶中提取出來並執行，即可修改我們想變化的地方。

```javascript
const bucket = new Set()
const data = {text:'hello'}

const obj = new Proxy(data,{
  get(target,key){
    bucket.add(effect)
    return target[key]
  },
  set(target,key,newVal){
    target[key] = newVal
    bucket.forEach(fn => fn())
    return true
  }
})

const effect = () => document.body.innerText = obj.text


// test
effect()
setTimeout(() =>{
  obj.text = 'hello vu3'
},1000)
```

當前已經能實現響應式數據了，不過並不是那麼彈性， `effect` 屬於硬編碼。我們需要讓用戶傳入自己定義的函數，並且與修改的數據做關聯性，否則修改無關聯的數據時，可能會觸發非關聯的 `effect`。  

讓我們重新調整 桶的資料結構，使用樹形結構讓其關聯

``` javascript
const bucket = new WeakMap()

let activeEffect
function effect (fn){
  activeEffect = fn
  fn()
}
const data = {text:'hello'}

const obj = new Proxy(data,{
  get(target,key){
    if(!activeEffect) return target[key]

    let depsMap = bucket.get(target)
    if(!depsMap) bucket.set(target, (depMap = new Map()))

    let deps = depsMap.get(key)
    if(!deps) depsMap.set(key,(deps = new Set()))
    deps.add(activeEffect)

    return target[key]
  },
  set(target,key,newVal){
    target[key] = newVal
    const depsMap = bucket.get(target)
    if(!depsMap) return 
    const effects = depsMap.get(key)
    effects && effects.forEach(fn => fn())
  }
})
```

- WeakMap 由 taget --> Map 構成
- Map 由 key --> Set 構成，用來儲存依賴集合(`effect`)

  註: 可以去理解 WeakMap、Map 差別在於哪 

這樣我們的樹形結構也完成了
```
target 
|__ key
    |__ effect
```

接著讓我們重構一下 把副作用函數 `effect` 收集到桶裡的邏輯 與 觸發 `effect` 重新執行的邏輯

```javascript
const obj = new Proxy(data,{
  get(target,key){
    track(target,key)
    return target[key]
  },
  set(target,key,newVal){
    target[key] = newVal
    trigger(target,key)
  }
})

// 函數追蹤變化
function track(target,key){
  if(!activeEffect) return 
  let depsMap = bucket.get(target)
  if(!depsMap) bucket.set(target, (depsMap = new Map()))

  let deps = depsMap.get(key)
  if(!deps) depsMap.set(key,(deps = new Set()))
  deps.add(activeEffect)
}

// 函數觸發變化
function trigger(target,key){
  const depsMap = bucket.get(target)
  if(!depsMap) return
  const effects = depsMap.get(key)
  effects && effects.forEach(fn => fn())
}
```

### 分支切換 與 cleanup

首先必須先明確分支切換的定義
```
const data = { ok :true, text: 'hello world'}
const obj = new Proxy(data,{/* ... */})

effect(function effectFn () {
  document.body.innerText = obj.ok ? obj.text : 'not'
})
```

根據 `obj.ok` 值不同，會執行不同的代碼分支，當 `obj.ok` 值發生變化時，代碼執行的分支也會跟著發生變化，這就是所謂的分支切換。  

分支切換可能會產生遺留的副作用函式，以上面例子來說，當 `obj.ok = true` 時， `obj.ok` 與 `obj.text` 分別會存入依賴集合 `effectFn`。  

而 `obj.ok = false` 時，`effectFn` 副作用函式不應該存在 `obj.text` 的依賴集合中，否則當 `obj.text` 值發生變化，還是會觸發 `effectFn`， 即使已經確定 `effectFn` 的值為 `not` 。 

要解決這個問題的思路很簡單，只要當執行副作用函式時，把他從所有與之關聯的依賴集合中刪除，當副作用函式執行完畢後，會重新建立聯繫，這樣就可以把遺留的副作用函式刪除。  
