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
```javascript
const data = { ok :true, text: 'hello world'}
const obj = new Proxy(data,{/* ... */})

effect(function effectFn () {
  document.body.innerText = obj.ok ? obj.text : 'not'
})
```

根據 `obj.ok` 值不同，會執行不同的代碼分支，當 `obj.ok` 值發生變化時，代碼執行的分支也會跟著發生變化，這就是所謂的分支切換。  

分支切換可能會產生遺留的副作用函式，以上面例子來說，當 `obj.ok = true` 時， `obj.ok` 與 `obj.text` 分別會存入依賴集合 `effectFn`。  

而 `obj.ok = false` 時，`effectFn` 副作用函式不應該存在 `obj.text` 的依賴集合中，否則當 `obj.text` 值發生變化，還是會觸發 `effectFn`， 即使已經確定 `effectFn` 的值為 `not` 。 

要解決這個問題的思路很簡單，只要當執行副作用函式時把他從所有與之關聯的依賴集合中刪除(`cleanup`)，當副作用函式執行完畢後，會重新建立聯繫，這樣就可以把遺留的副作用函式刪除。  

為了完成上面步驟，我們需要
1. 執行 `effect` 時創建一個空陣列來儲存 有依賴 `effectFn` 的集合
2. 當 `effectFn` 被執行時，先刪除關聯的依賴集合 (`cleanup`)
3. 在 `track` 中重新建立聯繫

再完成[上面功能](https://github.com/LeoWangJ/learn-vue3-sourcecode/commit/051186c7b42c1259b432cf79a359d3087f8a0565)後，我們來測試看看

```javascript
const data = { ok :true, text: 'hello world'}

/* 省略 obj... */

1.
effect(function effectFn () {
  document.body.innerText = obj.ok ? obj.text : 'not'
})

2. 
setTimeout(()=>{
  obj.ok = false
},3000)

3.
setTimeout(() =>{
  obj.text = 'hello vu3'
},5000)
```

1.  觸發 `effectFn`, 並且在 track 中會將 `obj.ok` & `obj.text` 存進 `activeEffect.deps` 中， 而 `effectFn` 會被存進  `obj.ok` & `obj.text` 的依賴集合中。

2. 觸發 `trigger`， 此時會執行 `obj.ok` 的依賴集合，執行依賴集合(`effectFn`)時會先刪除與之關聯的依賴集合(`cleanup`) 也就是 `obj.ok` & `obj.text`，當`effectFn` 執行完畢， `track` 會重新建立聯繫(`activeEffect.deps`)，此時只有 `obj.ok` 的`track` 被觸發，也就完成了我們刪除代碼分支存在遺留的副作用函式問題。

3. 觸發 `obj.text` 的 `trigger`， 不過由於再上一步已經將依賴集合刪除了，此時`bucket` 裡的 `obj.text` 依賴集合為空集合，因此不會任何的依賴集合。 

### 嵌套的 effect 與 effect stack

其實 Vue 的渲染函數是在一個 effect 中執行的

```javascript
const Foo = {
  render(){
    return /* ... */
  }
}


effect(()=>{
  Foo.render()
})
```

當組件發生嵌套時，其實就發生了 `effect` 嵌套

```javascript
const Bar = {
  render(){ /* ... */}
}

const Foo = {
  render() {
    return <Bar/>
  }
}

effect(()=>{
  Foo.render()
  effect(()=>{
    Bar.render()
  })
})
```

不過目前我們的 `effect` 是不支持嵌套的，由於我們用全局變數 `activeEffect` 來儲存副作用函數，而同時間所儲存的副作用函數只能有一個，並且沒有辦法還原之前的副作用函式，而我們可以使用 stack 收集副作用函式來解決該問題。  

```javascript
function effect (fn){
  const effectFn = () =>{
    cleanup(effectFn)
    activeEffect = effectFn
    effectStack.push(effectFn)
    fn()
    effectStack.pop(effectFn)
    activeEffect = effectStack[effectStack.length - 1]
  }
  effectFn.deps = []
  effectFn()
}
```

### 避免無限遞迴循環
先看個例子
```javascript
const data = { foo: 1}
const obj = new Proxy(data,{/* ... */})

effect(()=> obj.foo++)
```

`obj.foo++` 為自增程式碼，該操作會造成棧溢出問題，原因是讀取 `obj.foo` 值時觸發 `track` 操作，將當前副函式收集到桶中，接著加1 賦值給 `obj.foo`，觸發了 `trigger` 操作，而 `trigger` 會執行副作用函式，但當前的副作用函式還沒執行完畢，所以造成無限遞迴調用自己，產生了棧溢出。  

如果 `trigger` 觸發執行的副作用函式與當前正在執行的副作用函式相同，則不進行觸發
```javascript

function trigger(target,key){
  const depsMap = bucket.get(target)
  if(!depsMap) return
  const effects = depsMap.get(key)
  const effectsToRun = new Set(effects)
  // 新增
  effects && effects.forEach(effectFn =>{
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
    }
  })

  effectsToRun.forEach(effectFn => effectFn())
}

```

### 調度執行

可調度性是響應系統非常重要的特性，所謂可調度性是指當 `trigger` 動作觸發副作用函數重新執行時，有能力決定副作用函式執行的時機、次數以及方式。  

我們可以為 `effect` 設計一個選項參數 `options`，允許用戶指定調度器 `scheduler`，並且在`trigger` 判斷如果有調度器時，則執行調度器，讓使用者可以自由決定副作用函數執行時機、次數、方式。  
``` javascript
function effect (fn,options = {}){
  /* ... */
  effectFn.options = options
  effectFn.deps = []
  effectFn()
}

function trigger(target,key){
  /* ... */
  effectsToRun.forEach(effectFn => {
    // 如果存在調度器，則調用調度器，並將副作用函式作為參數傳遞
    if(effectFn.options.scheduler){
      effectFn.options.scheduler(effectFn)
    }else{
      effectFn()
    }
  })
}
```

### 計算屬性 computed 與 lazy

當前我們所實現的 `effect` 會立即執行傳給他的副作用函式，但是在某些場景我們並不希望立即執行，而是在需要他時才執行，例如 `computed`，這時懶執行 (`lazy`) 的 `effect` 可以達到目的。
可以在 `options` 中添加 `lazy` 屬性，只要 `lazy = true` 就不立即執行副作用函式。  

```javascript
function effect (fn,options = {}){
  /* ... */
  effectFn.options = options
  effectFn.deps = []
  // 非 lazy 的時候才執行
  if(!options.lazy){
    effectFn()
  }
  // 將副作用函式回傳
  return effectFn
}
```

此時將副作用函式當作一個 `getter`，這樣手動執行副作用函數時，就能夠拿到返回值。 

```javascript
const effectFn = effect(
  () => obj.foo + obj.bar,
  { lazy : true }
)
const value = effectFn()
```

不過依照目前 `effect` 函式，還沒辦法返回 `getter` 的值，因為現在返回的只是我們代理的副作用函式，並不是真正副作用函式處理後的值，我們需要再對 `effect` 做處理

```javascript
function effect (fn,options = {}){
  const effectFn = () =>{
    cleanup(effectFn)
    activeEffect = effectFn
    effectStack.push(effectFn)
    const res = fn()
    effectStack.pop(effectFn)
    activeEffect = effectStack[effectStack.length - 1]
    // 新增: 將真正的副作用函式執行結果返回
    return res
  }
  effectFn.options = options
  effectFn.deps = []
  // 非 lazy 的時候才執行
  if(!options.lazy){
    effectFn()
  }
  return effectFn
}
```

依照上面的修改，此時我們的響應式數據功能已經能實現計算屬性了

```javascript
function computed(getter){
  const effectFn = effect(getter,{
    lazy:true
  })
  const obj = {
    // 當讀取 value 時才會執行 effectFn
    get value(){
      return effectFn()
    }
  }

  return obj
}

// test
const data = {  bar:1, foo: 2 }
const obj = new Proxy(data, { /* ... */})

const sumRes = computed(()=> obj.bar + obj.foo)
console.log(sumRes.value) // 3
```

不過目前讀取 `computed` 的回傳值，就會觸發一次副作用函式來進行計算，就算監聽的值沒有發生變化。我們需要對其優化，添加對值進行緩存的功能 

```javascript
function computed(getter){
  // 緩存上一次計算的值
  let value 
  // 標示是否需要重新計算值， 為 true 代表 需要計算
  let dirty = true

  const effectFn = effect(getter,{
    lazy:true,
    // 調度器中將 dirty 重置為 true ， 避免監聽的值修改了卻不會重新計算
    scheduler(){
      dirty = true
    }
  })
  const obj = {
    // 當讀取 value 時才會執行 effectFn
    get value(){
      if(dirty){
        value = effectFn()
        dirty = false
      }
      return value
    }
  }

  return obj
}
```

不過還是有一個缺陷，當 `computed` 值發生變化時，我們讀取`sumRes.value` 的副作用函式並不會被觸發。

```javascript
const sumRes = computed(()=> obj.foo + obj.bar)
// computed 發生變化時，並不會再次調用該副作用函式
effect(()=>{
  console.log(sumRes.value)
})

obj.foo++
```

原因出自於 `computed` 裡的 `effect` 是懶執行的，只有當真正讀取`computed` 的值時才會執行，所以對於修改`computed` 依賴 `obj.foo` 的值，並沒有讀取 `sumRes.value` 而副作用函式當然也沒被觸發

解決方法很簡單，當讀取`computed` 的值時，我們可以手動調用`track` 進行追蹤，當 `computed` 依賴的響應式數據發生變化時，則手動調用 `trigger` 觸發響應

```javascript
function computed(getter){
  // 緩存上一次計算的值
  let value 
  // 標示是否需要重新計算值， 為 true 代表 需要計算
  let dirty = true

  const effectFn = effect(getter,{
    lazy:true,
    // 調度器中將 dirty 重置為 true ， 避免監聽的值修改了卻不會重新計算
    scheduler(){
      dirty = true
      // 當計算屬性依賴的響應式數據發生變化時，手動調用 trigger 觸發響應
      trigger(obj,'value')
    }
  })
  const obj = {
    // 當讀取 value 時才會執行 effectFn
    get value(){
      if(dirty){
        value = effectFn()
        dirty = false
      }
      // 當讀取 value 時，手動調用 track 進行追蹤
      track(obj,'value')
      return value
    }
  }

  return obj
}

```

### watch 的實現原理

`watch` 其本質就是觀測一個響應式數據，當數據發生變化時通知並執行相對應的回調函數。
是利用了 `effect` 以及 `options.scheduler` 選項組合而成

```javascript
function watch(source,cb){
  effect(
    // 調用 traverse 遞歸地讀取
    ()=> traverse(source),
    {
      scheduler(){
        cb()
      }
    }
  )
}

function traverse(value,seen = new Set()){
  // 如果要讀取的數據是原始值，或者已經被讀取過了，那什麼都不做
  if(typeof value !== 'object' || value === null | seen.has(value)) return
  // 將數據添加到 seen 中， 代表遍歷讀取過了，避免循環引用引起死循環
  seen.add(value)
  for(const k in value){
    traverse(value[k],seen)
  }
  return value
}
```

也可以傳遞一個 `getter` 函式，因此我們需要支援傳入函式
```javascript
function watch(source,cb){
  let getter
  if(typeof source === 'function'){
    getter = source
  }else{
    getter = () => traverse(source)
  }

  effect(
    ()=> getter(),
    {
      scheduler(){
        cb()
      }
    }
  )
}
```

在平常業務中，最常使用的新值與舊值功能我們還沒實現，如何獲取舊值呢？
其實透過 `lazy` 就能簡單實現該功能， 首次呼叫 `watch` 時，手動呼叫 `effectFn`，當每次獲取 `newValue` 後，切記要將當前 `newValue` 賦值給 `oldValue`，否則 `oldValue` 永遠是首次呼叫 `watch` 時的值

```javascript
function watch(source,cb){
  let getter
  if(typeof source === 'function'){
    getter = source
  }else{
    getter = () => traverse(source)
  }

  let oldValue, newValue
  const effectFn = effect(
    ()=> getter(),
    {
      lazy:true,
      scheduler(){
        newValue = effectFn()
        cb(newValue,oldValue)
        // 將舊值更新
        oldValue = newValue
      }
    }
  )
  // 首次調用 watch 時獲取舊值
  oldValue = effectFn()
}
```

### 立即執行的 watch 與回調執行時機

再使用 [Vue watch](https://cn.vuejs.org/api/options-state.html#watch) 時，我們有時會使用到 立即執行 `immediate` 與 回調執行時機 [flush](https://cn.vuejs.org/guide/essentials/watchers.html#callback-flush-timing) 參數，接下來我們來封裝這兩個 `options`

`immediate` 回調函式會在 `watch` 創建時立即執行一次， 該功能其實調用當前 `scheduler` 裡的方法即可， 我們將當前 `scheduler` 裡的方法封裝成一個函式

```javascript
function watch(source,cb,options = {}){
  /* ... */
  let oldValue, newValue
  
  const job = () =>{
    newValue = effectFn()
    cb(newValue,oldValue)
    // 將舊值更新
    oldValue = newValue
  }

  const effectFn = effect(
    ()=> getter(),
    {
      lazy:true,
      scheduler: job
    }
  )
  
  if(options.immediate){
    job()
  }else{
    // 首次調用 watch 時獲取舊值
    oldValue = effectFn()
  }
}
```

接著來實現 `flush` 'post' 功能，`post` 代表調度函式需要將副作用函式放到一個微任務中，並等待 `DOM` 更新結束後再執行 

```javascript
//watch
const effectFn = effect(
  ()=> getter(),
  {
    lazy:true,
    scheduler: ()=>{
      if(options.flush === 'post'){
        const p = Promise.resolve()
        p.then(job)
      }else{
        job()
      }
    }
  }
)
```

### 過期的副作用

如果在 `watch` 中使用非同步方法時，有時會產生競態問題，意思是假設第一次觸發回調，call 了一次 API 稱為 A，但還沒返回時，又觸發第二次回調 B，此時B的資料先返回，後續才是 A ，但我們認定 B 的資料是最新的，這時就會發生顯示到舊資料的問題。

為了解決該問題， 必須在 `watch` 中提供方法讓使用者拋棄舊有結果，供使用者解決該問題。  
我們可以提供一個 `onInvalidate` 方法 以及 `cleanup` 來紀錄是否有過期回調，

```javascript
function watch(source,cb,options = {}){
  /* ... */
  
  // cleanup 用來存儲用戶註冊的過期回調
  let cleanup
  
  // onInvalidate 函數
  function onInvalidate(fn){
    // 將過期回調存儲到 cleanup 中
    cleanup = fn
  }

  const job = () =>{
    newValue = effectFn()
    // 在回調函式 cb 之前，先調用過期回調
    if(cleanup){
      cleanup()
    }
    // 將 onInvalidate 作為回調函式的第三個參數，以便用戶使用
    cb(newValue,oldValue,onInvalidate)
    // 將舊值更新
    oldValue = newValue
  }
  /* ... */
}
```

此時使用者就能調用 `onInvalidate` 方法，當 `cleanup` 存在時就會呼叫 `onInvalidate` 裡提供的函式。

```javascript
watch(obj,async (newValue,oldValue,onInvalidate)=>{
  let expired = false
  onInvalidate(()=>{
    expired = true
  })

  const res = await fetch('/path/XXX',obj)
  if(!expired){
    data = res
  }
})
// first A
obj.foo++
setTimeout(()=>{
  // second B after 200ms
  obj.foo++
},200)
```

以上面例子來說，首次更新 `obj.foo` 時， A `expired = false` ， 當 200ms 後修改 `obj.foo` ，此時 cleanup 的值會是 A 的過期回調， 將 A `expired` 改為 `true` ，這樣就算 A 比較晚回傳回來， 也不會將 `res` 結果賦值給 `data`


## 非原始值的響應式方案

### 如何代理 Object

一個普通物件的所有可能讀取操作:
1. 訪問屬性： obj.foo
2. 判斷物件或原型上是否存在給定的 key： key in obj
3. 使用 for ... in 循環遍歷物件： for(cont key in obj) {}

目前我們僅支援訪問屬性，接下來需要處理剩下的情況
- 攔截 in 操作符
參考 [Proxy has](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/has)

```javascript
const obj = new Proxy(data,{
  has(target,key){
    track(target,key)
    return Reflect.has(target,key)
  }
})
```
- 攔截 for ... in 循環
我們可以透過 [Proxy ownKeys](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/ownKeys) 攔截函數
```javascript
const data = { foo:1 }
const obj = new Proxy(data,{
  ownKeys(target){
    // 將副作用函式與 ITERATE_KEY 關聯
    track(target,ITERATE_KEY)
    return Reflect.ownKeys(target)
  }
})

effect(()=>{
  for(const key in obj){
    console.log(key) // foo
  }
})
```
此時我們用 `for ... in` 讀取 `obj` 代理物件時， 會將 `ITERATE_KEY` 副作用函式做關聯。  

```
obj.foo = 2
```
我們對 `obj` 添加 `foo` 參數時，理想上是會觸發 `ITERATE_KEY` 副作用函式重新執行， 不過當前 `set` 攔截函數接收到的 `key` 會是 `foo` 所以並不會觸發 `ITERATE_KEY` 副作用函式。

要解決這問題，只要當添加屬性時，將那些與 `ITERATE_KEY` 相關聯的副作用函式也取出來就可以了。
```javascript
function trigger(target,key){
  const depsMap = bucket.get(target)
  if(!depsMap) return
  const effects = depsMap.get(key)
  // 取得與 ITERATE_KEY 相關連的副作用函式
  const iterateEffects = depsMap.get(ITERATE_KEY)

  // 創建一個新的Set，可參考 Set.prototype.forEach 會造成什麼問題
  const effectsToRun = new Set(effects)
  effects && effects.forEach(effectFn =>{
    // 如果 trigger 觸發執行的副作用函式與當前正在執行的副作用函式相同，則不進行觸發
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
    }
  })

  iterateEffects & iterateEffects.forEach(effectFn =>{
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
    }
  })
  
  effectsToRun.forEach(effectFn => {
    // 如果存在調度器，則調用調度器，並將副作用函式作為參數傳遞
    if(effectFn.options.scheduler){
      effectFn.options.scheduler(effectFn)
    }else{
      effectFn()
    }
  })
}
```

此時新增屬性已經可以正常觸發 `ITERATE_KEY` 副作用函式，但是當我們修改屬性的值時，對於 `foo ... in` 來說並不會產生影響，所以需要區分新增屬性與修改屬性，當只有新增屬性時，我們才會觸發 `ITERATE_KEY` 副作用函式

```javascript
const triggerType = {
  SET:'SET',
  ADD:'ADD',
}

const obj = new Proxy(data,{
  set(target,key,newVal,receiver){
    // 如果屬性不存在，則說明是在添加新屬性，否則是設置已有屬性
    const type = Object.prototype.hasOwnProperty.call(target,key) ? triggerType.SET : triggerType.ADD
    // 設置屬性值
    const res = Reflect.set(target,key,newVal,receiver)
    trigger(target,key)
    return res
  }
})

function trigger(target,key, type){
  /* ... */
  // 只有操作類型為 'ADD' 時，才觸發與 ITERATE_KEY 相關聯的副作用函式重新執行
  if(type === triggerType.ADD){
    iterateEffects & iterateEffects.forEach(effectFn =>{
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
      }
    })
  }
  /* ... */
}
```
接下來就剩下刪除屬性操作的代理要處理，可以使用 [proxy deleteProperty](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/deleteProperty) 來攔截

```javascript
const obj = new Proxy(data,{
  deleteProperty(target,key){
    const hadKey = Object.prototype.deleteProperty.call(target,key)
    const res = Reflect.deleteProperty(target,key)

    if(res && hadKey){
      trigger(target,key,triggerType.DELETE)
    }
    return res
  }
})

function trigger(target,key, type){
  /* ... */
  // 只有操作類型為 'ADD' 或 'DELETE' 時，才觸發與 ITERATE_KEY 相關聯的副作用函式重新執行
  if(type === triggerType.ADD || type === triggerType.DELETE){
    iterateEffects & iterateEffects.forEach(effectFn =>{
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
      }
    })
  }
  /* ... */
}
```

### 合理地觸發響應
雖然我們完成了物件響應的各種情況，不過某些情況還是沒有處理到
1. 當值沒有發生變化時，不需要觸發響應
```javascript
const obj = { foo : 1}
const p = new Proxy(obj,{ /* ... */})
effect(() => {
  console.log(p.foo)
})
// 理想情況，修改的值沒變化時，不應該觸發副作用函式
p.foo = 1
```

要處理這問題，在 `set` 上判斷當新值與舊值相同時，就不去觸發 `trigger`

```javascript
  const obj = new Proxy(data,{
    set(target,key,newVal,receiver){
      const oldVal = target[key]

      // 如果屬性不存在，則說明是在添加新屬性，否則是設置已有屬性
      const type = Object.prototype.hasOwnProperty.call(target,key) ? triggerType.SET : triggerType.ADD
      // 設置屬性值
      const res = Reflect.set(target,key,newVal,receiver)
      // 新值與舊值做比較，當不全等時才會觸發
      if(oldVal !== newVal){
        trigger(target,key,type)
      }
      return res
    },
  })
```

2. NaN === NaN, NaN !== NaN 情況
依照上述用判斷不全等的方式，在一些情況下還是會失效，例如 `NaN !== NaN`，所以我們需要更嚴謹的判斷方式

```javascript
const obj = new Proxy(data,{
    set(target,key,newVal,receiver){
      const oldVal = target[key]

      // 如果屬性不存在，則說明是在添加新屬性，否則是設置已有屬性
      const type = Object.prototype.hasOwnProperty.call(target,key) ? triggerType.SET : triggerType.ADD
      // 設置屬性值
      const res = Reflect.set(target,key,newVal,receiver)
      // 新值與舊值做比較，當不全等且都不是 NaN 情況時才會觸發
      if(oldVal !== newVal && (oldVal === oldVal || newVal === newVal)){
        trigger(target,key,type)
      }
      return res
    },
  })
```
3. 原型上繼承屬性
在處理該問題之前，我們先封裝一個 `vue3 reactive` 函式，方便後續處理
```javascript
function reactive(obj){
  return new Proxy(obj,{ /* ... */})
}
```

```javascript
const obj = {}
const proto = {bar:1}
const child = reactive(obj)
const parent = reactive(proto)
Object.setPrototypeOf(child,parent)

effect(()=>{
  console.log(child.bar)
})

child.bar = 2 // 會導致副作用函式重新執行兩次
```
理想中我們應該只會觸發一次 副作用函式，但是現實中會觸發兩次。  
原因是因為我們繼承的 `parent` 也是響應式，副作用函式也會被收集，所以觸發了兩次。  
找到原因後，我們只要能夠在 `set` 攔截函式區分即可

```javascript
function reactive(obj) {
  return new Proxy(obj,{
    get(target,key){
      if(key === 'raw'){
        return target
      }
      track(target,key)
      return target[key]
    },
    set(target,key,newVal,receiver){
      const oldVal = target[key]
  
      // 如果屬性不存在，則說明是在添加新屬性，否則是設置已有屬性
      const type = Object.prototype.hasOwnProperty.call(target,key) ? triggerType.SET : triggerType.ADD
      // 設置屬性值
      const res = Reflect.set(target,key,newVal,receiver)
      // 新值與舊值做比較，當不全等且都不是 NaN 情況時才會觸發
      if(target === receiver.raw){
        if(oldVal !== newVal && (oldVal === oldVal || newVal === newVal)){
         trigger(target,key,type)
        }
      }
      return res
    },
  })
}
```
### 淺響應與深響應
現在提供的 `reactive` 函式僅僅只能觸發一層物件的副作用函式
```javascript
cnost obj = reactive({foo:{bar:1}})

effect(()=>{
  console.log(obj.foo.bar)
})

// 修改值並不能觸發響應
obj.foo.bar = 2 
```

問題出在於 `get` 無法與 `bar` 物件做響應聯繫，無法觸發副作用函式
當前 `get` 方法
```javascript
function reactive(obj) {
  return new Proxy(obj,{
    get(target,key,receiver){
      if(key === 'raw'){
        return target
      }
      track(target,key)
      // 當讀取屬性值時，直接返回結果
      return Reflect.get(target,key,receiver)
    },
  })
}
```
我們必須判斷當 原始結果為物件時，需要對物件再使用 `reactive` 函式，使其變成響應式

```javascript
function reactive(obj) {
  return new Proxy(obj,{
    get(target,key,receiver){
      if(key === 'raw'){
        return target
      }
      track(target,key)
      // 得到原始結果
      const res = Reflect.get(target,key,receiver)
      if(typeof res === 'object' && res !== null){
        // 調用 reactive 將結果包裝成響應式數據並返回
        return reactive(res)
      }
      return res
    },
  })
}
```

但是這樣就會使全部物件都變成深響應，並不是所有情況下都需要，我們必須在兼容淺響應提供給用戶，所謂淺響應指的是只有物件第一層是響應式。  

在此之前，為了方便創造深響應(`reactive`)與淺響應(`shallowReactive`) 兩個函式，我們先封裝一個 `createReactive` 函式僅僅只能觸發一層物件的副作用函式

```javascript
function createReactive(obj,isShallow = false){
  return new Proxy(obj,{
    get(target,key,receiver){
      if(key === 'raw'){
        return target
      }
      // 得到原始結果
      const res = Reflect.get(target,key,receiver)
      track(target,key)
      
      // 如果是淺響應，直接返回原始值
      if(isShallow){
        return res
      }
      if(typeof res === 'object' && res !== null){
        // 調用 reactive 將結果包裝成響應式數據並返回
        return reactive(res)
      }
      return res
    },
    /* ... */
  })
}
```
接下來就可以輕鬆實作 `reactive` 與 `shallowReactive`

```javascript
function reactive(obj){
  return createReactive(obj)
}

function shallowReactive(obj){
  return createReactive(obj,true)
}
```
### 只讀和淺只讀
我們希望一些數據是只讀的，例如 `props` 物件，當嘗試修改時，會得到警告。  
目前可以修改數值的 `key` 為 `set` 、 `deleteProperty`

```javascript
function createReactive(obj,isShallow = false, isReadonly = false){
  return new Proxy(obj,{
    set(target,key,newVal,receiver){
      if(isReadonly){
        console.warn(`屬性 ${key} 是只讀的`)
        return true
      }
      /* ... */
    },
    deleteProperty(target,key){
      if(isReadonly){
        console.warn(`屬性 ${key} 是只讀的`)
        return true
      }
      /* ... */
    }
  })
}
```
除了修改數值之外，我們也無須對只讀值進行響應聯繫

```javascript
function createReactive(obj,isShallow = false, isReadonly = false){
  return new Proxy(obj,{
    get(target,key,receiver){
      if(key === 'raw'){
        return target
      }
      // 得到原始結果
      const res = Reflect.get(target,key,receiver)

      // 非只讀時才需要建立響應聯繫
      if(!isReadonly){
        track(target,key)
      }

      /* ... */
    },
  })
}
```

我們建立一個 `readonly` 函式即完成只讀
```javascript
function readonly(obj){
  return createReactive(obj,false,true)
}
```

不過目前還是無法進行深只讀，其實深只讀與深響應判斷的地方相同，只需要判斷 `isReadonly` 為 `true` 時，改遞迴調用 `readonly` 函式即可

```javascript
function createReactive(obj,isShallow = false, isReadonly = false){
  return new Proxy(obj,{
    get(target,key,receiver){
      if(key === 'raw'){
        return target
      }
      // 得到原始結果
      const res = Reflect.get(target,key,receiver)

      // 非只讀時才需要建立響應聯繫
      if(!isReadonly){
        track(target,key)
      }

      // 如果是淺響應，直接返回原始值
      if(isShallow){
        return res
      }
      if(typeof res === 'object' && res !== null){
        return isReadonly ? readonly(res) : reactive(res)
      }
      return res
    }
  })
}

function readonly(obj){
  return createReactive(obj, false, true)
}
function shallowReadonly(obj){
  return createReactive(obj, true ,true)
}
```


### 代理陣列
待攥寫
<!-- #### 陣列的索引與 length

#### 遍歷陣列

#### 陣列的查找方法

#### 隱式 修改陣列長度的原型方法 -->

### 代理 Set 和 Map
待攥寫


## 原始值的響應方案
我們上述討論了非原始值的響應式方案，但是原始值(`null`、`undefined`、`number`、`string`、`symbol`、`boolean`、`BigInt`)的響應式方案尚未處理。

由於 `Proxy` 無法提供對原始值的代理，要對原始值響應，需要包覆一層物件，也就是 `vue3 ref` 的實現原理

```javascript
function ref(val){
  const wrapper = {
    value:val
  }

  // 為了區分是原始值的包覆對象還是非原始值的響應式數據，定義一個不可枚舉的屬性 __v_isRef
  Object.defineProperty(wrapper,'__v_isRef',{
    value: true
  })
  return reactive(val)
}
```

### 響應丟失問題
先來看一個情況
```javascript
const obj = reactive({foo:1,bar:2})
const newObj = {...obj}

effect(()=>{
  // 並不會觸發，因為透過展開運算符賦值給 newObj 時，已經丟失響應
  console.log(newObj.foo)
})

obj.foo = 100
```
此時會發現 `newObj` 已經不是響應式了，為了解決讓響應式延續，`vue` 提供了 `toRef` 這個方法

```javascript
function toRef(obj,key){
  const wrapper = {
    get value(){
      return obj[key]
    },
    set value(val){
      obj[key] = val
    }
  }
  
  Object.defineProperty(wrapper,'__v_isRef',{
    value: true
  })

  return wrapper
}
```

如果響應式數據的 `key` 值非常多，我們需要每個 `value` 都添加 `toRef`，這顯得非常麻煩，所幸 `vue` 提供 `toRefs` 方法，實現其實就是多一層遍歷

```javascript
function toRefs(obj){
  const ret = {}
  for(const key in obj){
    ret[key] = toRef(obj,key)
  }
  return ret
}
```
