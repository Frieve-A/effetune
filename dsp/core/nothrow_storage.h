#ifndef EFFETUNE_CORE_NOTHROW_STORAGE_H
#define EFFETUNE_CORE_NOTHROW_STORAGE_H

#include <cstddef>
#include <cstring>
#include <new>
#include <type_traits>
#include <utility>

namespace effetune {

template <typename T> class NothrowStorage {
public:
  NothrowStorage() = default;
  ~NothrowStorage() { delete[] data_; }
  NothrowStorage(const NothrowStorage &) = delete;
  NothrowStorage &operator=(const NothrowStorage &) = delete;
  void swap(NothrowStorage &other) noexcept {
    std::swap(data_, other.data_);
    std::swap(count_, other.count_);
  }

  bool allocate(std::size_t count) noexcept {
    release();
    if (count == 0u)
      return true;
    data_ = new (std::nothrow) T[count];
    if (data_ == nullptr)
      return false;
    count_ = count;
    return true;
  }

  void release() noexcept {
    delete[] data_;
    data_ = nullptr;
    count_ = 0u;
  }

  void clear() noexcept {
    static_assert(std::is_trivially_copyable_v<T>);
    if (data_ != nullptr)
      std::memset(data_, 0, count_ * sizeof(T));
  }

  [[nodiscard]] T *data() noexcept { return data_; }
  [[nodiscard]] const T *data() const noexcept { return data_; }
  [[nodiscard]] std::size_t size() const noexcept { return count_; }

private:
  T *data_ = nullptr;
  std::size_t count_ = 0u;
};

} // namespace effetune

#endif
